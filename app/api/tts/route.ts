import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import OpenAI from 'openai'
import { getUserKey } from '@/lib/getUserKey'

export const maxDuration = 60

const SARVAM_LANG: Record<string, string> = {
  hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN',
  ml: 'ml-IN', bn: 'bn-IN', mr: 'mr-IN', pa: 'pa-IN',
  gu: 'gu-IN', or: 'od-IN',
}
const SARVAM_SPEAKER: Record<string, string> = {
  'hi-IN': 'meera', 'ta-IN': 'pavithra', 'te-IN': 'maitreyi',
  'kn-IN': 'maitreyi', 'ml-IN': 'maitreyi', 'bn-IN': 'meera',
  'mr-IN': 'meera', 'pa-IN': 'meera', 'gu-IN': 'meera', 'od-IN': 'meera',
}

// ElevenLabs Rachel — available in all accounts, supports Multilingual v2
const EL_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { text, language } = await request.json() as { text: string; language: string }

  if (!text?.trim())     return Response.json({ error: 'text is required' }, { status: 400 })
  if (!language?.trim()) return Response.json({ error: 'language is required' }, { status: 400 })

  const baseLang = language.toLowerCase().split('-')[0]
  if (baseLang === 'en') return Response.json({ error: 'English TTS is handled on-device' }, { status: 400 })

  const resolved = await getUserKey(session.user.id, 'tts', baseLang)
  if (!resolved) {
    return Response.json(
      { error: 'No API key configured for voiceover. Add a key in Settings → API Keys.' },
      { status: 402 },
    )
  }

  const { key, provider, ttsQuality } = resolved

  try {
    if (provider === 'openai') {
      const client = new OpenAI({ apiKey: key })
      const model  = ttsQuality === 'hd' ? 'tts-1-hd' : 'tts-1'
      const res    = await client.audio.speech.create({ model, voice: 'alloy', input: text })
      const buffer = Buffer.from(await res.arrayBuffer())
      return new Response(buffer, { headers: { 'Content-Type': 'audio/mpeg' } })
    }

    if (provider === 'elevenlabs') {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const buffer = Buffer.from(await res.arrayBuffer())
      return new Response(buffer, { headers: { 'Content-Type': 'audio/mpeg' } })
    }

    if (provider === 'sarvam') {
      const langCode = SARVAM_LANG[baseLang] ?? 'hi-IN'
      const speaker  = SARVAM_SPEAKER[langCode] ?? 'meera'
      const res = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [text],
          target_language_code: langCode,
          speaker,
          model: 'bulbul:v1',
          enable_preprocessing: true,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { audios } = await res.json() as { audios: string[] }
      const buffer = Buffer.from(audios[0], 'base64')
      return new Response(buffer, { headers: { 'Content-Type': 'audio/wav' } })
    }

    return Response.json({ error: 'Unknown provider' }, { status: 500 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: msg }, { status: 500 })
  }
}
