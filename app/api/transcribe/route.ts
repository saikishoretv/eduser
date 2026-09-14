import OpenAI from 'openai'

export const maxDuration = 120

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json({ error: 'GROQ_API_KEY is not configured on the server' }, { status: 500 })
  }

  const formData = await request.formData()
  const audio = formData.get('audio') as File | null
  if (!audio) {
    return Response.json({ error: 'No audio file provided' }, { status: 400 })
  }

  const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  })

  const transcription = await openai.audio.transcriptions.create({
    file: audio,
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment', 'word'],
  })

  const raw = transcription as {
    language?: string
    segments?: { text: string; start: number; end: number }[]
    words?: { word: string; start: number; end: number }[]
  }

  const rawSegments = raw.segments ?? []
  const rawWords = raw.words ?? []

  const segments = rawSegments.map(s => ({
    text: s.text.trim(),
    start: s.start,
    end: s.end,
    words: rawWords
      .filter(w => w.start >= s.start && w.end <= s.end + 0.05)
      .map(w => ({ word: w.word.trim(), start: w.start, end: w.end })),
  }))

  return Response.json({ segments, language: raw.language ?? null })
}
