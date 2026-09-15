import Anthropic from '@anthropic-ai/sdk'
import { TranscriptSegment } from '@/types'

export const maxDuration = 120

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, { status: 500 })
  }

  const body = await request.json() as {
    segments: TranscriptSegment[]
    targetLanguage: string
    sourceLanguage?: string
  }

  const { segments, targetLanguage, sourceLanguage } = body

  if (!segments?.length) {
    return Response.json({ error: 'No segments provided' }, { status: 400 })
  }
  if (!targetLanguage) {
    return Response.json({ error: 'No target language provided' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Build numbered list of segment texts for a single batched translation call
  const numbered = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n')
  const fromClause = sourceLanguage ? ` from ${sourceLanguage}` : ''

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Translate the following numbered subtitle segments${fromClause} to ${targetLanguage}. Return only the translated lines in the same numbered format, preserving the numbering. Do not add explanations or extra text.

${numbered}`,
      },
    ],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''

  // Parse numbered lines back into translated texts
  // Build a map by number to tolerate reordering or extra blank lines from Claude
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

  // Return segments with translated text, original timing, and no word timestamps
  const translated: TranscriptSegment[] = segments.map((s, i) => ({
    text: translatedTexts[i],
    start: s.start,
    end: s.end,
    words: [], // word-level highlighting not available for translations
  }))

  return Response.json({ segments: translated })
}
