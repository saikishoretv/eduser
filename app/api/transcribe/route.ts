import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import OpenAI from 'openai'
import { getUserKey } from '@/lib/getUserKey'

export const maxDuration = 120

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const audio = formData.get('audio') as File | null
  if (!audio) return Response.json({ error: 'No audio file provided' }, { status: 400 })

  // Resolve key: user's Groq or OpenAI key → fallback to app's Groq key
  const resolved = await getUserKey(session.user.id, 'transcription')
  const apiKey   = resolved?.key ?? process.env.GROQ_API_KEY
  const baseURL  = (!resolved || resolved.provider === 'groq')
    ? 'https://api.groq.com/openai/v1'
    : undefined

  if (!apiKey) return Response.json({ error: 'No API key configured for transcription' }, { status: 500 })

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  const model  = (!resolved || resolved.provider === 'groq') ? 'whisper-large-v3-turbo' : 'whisper-1'

  const transcription = await client.audio.transcriptions.create({
    file: audio,
    model,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment', 'word'],
  })

  const raw = transcription as {
    language?: string
    segments?: { text: string; start: number; end: number }[]
    words?:    { word: string; start: number; end: number }[]
  }

  const rawSegments = raw.segments ?? []
  const rawWords    = raw.words    ?? []

  const segments = rawSegments.map(s => ({
    text:  s.text.trim(),
    start: s.start,
    end:   s.end,
    words: rawWords
      .filter(w => w.start >= s.start && w.end <= s.end + 0.05)
      .map(w => ({ word: w.word.trim(), start: w.start, end: w.end })),
  }))

  return Response.json({ segments, language: raw.language ?? null })
}
