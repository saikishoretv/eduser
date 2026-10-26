import { getDb } from './mongodb'
import { decryptKey } from './keyEncrypt'

export type Provider = 'openai' | 'groq' | 'elevenlabs' | 'sarvam'
export type Feature  = 'transcription' | 'translation' | 'script' | 'tts'

export interface ResolvedKey {
  key:         string
  provider:    Provider
  ttsQuality?: 'standard' | 'hd'
}

// Priority order per feature (first match wins)
const PRIORITY: Record<Feature, Provider[]> = {
  transcription: ['groq', 'openai'],
  translation:   ['groq', 'openai'],
  script:        ['groq', 'openai'],
  tts:           ['sarvam', 'elevenlabs', 'openai'],
}

const INDIC = new Set(['hi', 'ta', 'te', 'kn', 'ml', 'bn', 'mr', 'pa', 'gu', 'or'])

export async function getUserKey(
  userId: string,
  feature: Feature,
  language?: string,
): Promise<ResolvedKey | null> {
  const db   = await getDb()
  const docs = await db.collection('user_api_keys')
    .find({ userId, features: feature })
    .toArray()

  if (!docs.length) return null

  // For Indic TTS, prefer sarvam first
  const priority = (feature === 'tts' && language && INDIC.has(language.toLowerCase().split('-')[0]))
    ? (['sarvam', 'elevenlabs', 'openai'] as Provider[])
    : PRIORITY[feature]

  for (const provider of priority) {
    const doc = docs.find(d => d.provider === provider)
    if (!doc) continue
    const key = decryptKey(doc.encryptedKey, doc.iv, doc.authTag)
    return { key, provider, ttsQuality: doc.ttsQuality ?? 'standard' }
  }

  return null
}
