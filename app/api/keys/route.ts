import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getDb } from '@/lib/mongodb'
import { encryptKey, decryptKey, maskKey } from '@/lib/keyEncrypt'
import type { Provider, Feature } from '@/lib/getUserKey'

export const PROVIDER_FEATURES: Record<Provider, Feature[]> = {
  openai:     ['transcription', 'translation', 'script', 'tts'],
  groq:       ['transcription', 'translation', 'script'],
  elevenlabs: ['tts'],
  sarvam:     ['tts'],
}

async function validateKey(provider: Provider, key: string): Promise<void> {
  let res: Response
  if (provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error('Invalid OpenAI API key')
  } else if (provider === 'groq') {
    res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error('Invalid Groq API key')
  } else if (provider === 'elevenlabs') {
    res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key },
    })
    if (!res.ok) throw new Error('Invalid ElevenLabs API key')
  } else if (provider === 'sarvam') {
    // Minimal test call — 401/403 = invalid key, anything else = key is valid
    res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: ['test'], target_language_code: 'hi-IN', speaker: 'meera', model: 'bulbul:v1' }),
    })
    if (res.status === 401 || res.status === 403) throw new Error('Invalid Sarvam API key')
  }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db   = await getDb()
  const docs = await db.collection('user_api_keys')
    .find({ userId: session.user.id }, { projection: { encryptedKey: 0, iv: 0, authTag: 0 } })
    .toArray()

  return Response.json(docs.map(d => ({
    provider:   d.provider,
    maskedKey:  d.maskedKey,
    features:   d.features,
    ttsQuality: d.ttsQuality ?? 'standard',
    updatedAt:  d.updatedAt,
  })))
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { provider, key, features, ttsQuality } = await request.json() as {
    provider:    Provider
    key:         string
    features:    Feature[]
    ttsQuality?: 'standard' | 'hd'
  }

  if (!provider || !key) return Response.json({ error: 'provider and key are required' }, { status: 400 })

  const allowed = PROVIDER_FEATURES[provider]
  if (!allowed) return Response.json({ error: 'Unknown provider' }, { status: 400 })

  const validFeatures = features.filter(f => allowed.includes(f))

  try {
    await validateKey(provider, key)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Key validation failed' }, { status: 400 })
  }

  const { encryptedKey, iv, authTag } = encryptKey(key)
  const now = new Date()

  const db = await getDb()
  await db.collection('user_api_keys').updateOne(
    { userId: session.user.id, provider },
    {
      $set: { encryptedKey, iv, authTag, maskedKey: maskKey(key), features: validFeatures, ttsQuality: ttsQuality ?? 'standard', updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

  return Response.json({ provider, maskedKey: maskKey(key), features: validFeatures, ttsQuality: ttsQuality ?? 'standard' })
}

// PATCH — update features/ttsQuality without changing the key
export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { provider, features, ttsQuality } = await request.json() as {
    provider:    Provider
    features:    Feature[]
    ttsQuality?: 'standard' | 'hd'
  }

  if (!provider) return Response.json({ error: 'provider is required' }, { status: 400 })

  const allowed = PROVIDER_FEATURES[provider]
  if (!allowed) return Response.json({ error: 'Unknown provider' }, { status: 400 })

  const validFeatures = features.filter(f => allowed.includes(f))

  const db = await getDb()
  const result = await db.collection('user_api_keys').updateOne(
    { userId: session.user.id, provider },
    { $set: { features: validFeatures, ttsQuality: ttsQuality ?? 'standard', updatedAt: new Date() } },
  )

  if (result.matchedCount === 0) {
    return Response.json({ error: 'Key not found' }, { status: 404 })
  }

  return Response.json({ ok: true, features: validFeatures })
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { provider } = await request.json() as { provider: Provider }
  if (!provider) return Response.json({ error: 'provider is required' }, { status: 400 })

  const db = await getDb()
  await db.collection('user_api_keys').deleteOne({ userId: session.user.id, provider })

  return Response.json({ ok: true })
}
