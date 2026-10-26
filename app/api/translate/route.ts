import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getUserKey } from '@/lib/getUserKey'
import { TranscriptSegment } from '@/types'

export const maxDuration = 120

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    segments: TranscriptSegment[]
    targetLanguage: string
    sourceLanguage?: string
  }

  const { segments, targetLanguage, sourceLanguage } = body

  if (!segments?.length)  return Response.json({ error: 'No segments provided' }, { status: 400 })
  if (!targetLanguage)    return Response.json({ error: 'No target language provided' }, { status: 400 })

  const numbered  = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n')
  const fromClause = sourceLanguage ? ` from ${sourceLanguage}` : ''
  const prompt    = `Translate the following numbered subtitle segments${fromClause} to ${targetLanguage}. Return only the translated lines in the same numbered format, preserving the numbering. Do not add explanations or extra text.\n\n${numbered}`

  // Resolve key: user's Groq or OpenAI → fallback to app's Anthropic key
  const resolved = await getUserKey(session.user.id, 'translation')

  let raw: string

  if (resolved?.provider === 'groq') {
    const client = new OpenAI({ apiKey: resolved.key, baseURL: 'https://api.groq.com/openai/v1' })
    const res = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    })
    raw = res.choices[0]?.message?.content ?? ''
  } else if (resolved?.provider === 'openai') {
    const client = new OpenAI({ apiKey: resolved.key })
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    })
    raw = res.choices[0]?.message?.content ?? ''
  } else {
    // Fallback: app's Anthropic key
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'No API key configured for translation' }, { status: 500 })
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
    raw = message.content[0].type === 'text' ? message.content[0].text : ''
  }

  const lineMap = new Map<number, string>()
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(\d+)\.\s*(.+)/)
    if (m) lineMap.set(parseInt(m[1], 10), m[2].trim())
  }

  const translatedTexts = segments.map((_, i) => lineMap.get(i + 1) ?? '')
  const missing = translatedTexts.filter(t => !t).length
  if (missing > 0) {
    return Response.json({ error: `Translation incomplete: ${missing} segment(s) missing` }, { status: 500 })
  }

  const translated: TranscriptSegment[] = segments.map((s, i) => ({
    text:  translatedTexts[i],
    start: s.start,
    end:   s.end,
    words: [],
  }))

  return Response.json({ segments: translated })
}
