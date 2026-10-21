import { Clip } from '@/types'
import { getClipTimings } from '@/lib/clipUtils'
import { SilenceRegion } from '@/lib/silenceDetect'

const MIN_CLIP_DURATION = 0.05  // drop sub-clips shorter than this

export function applySilenceCuts(
  clips: Clip[],
  silenceRegions: SilenceRegion[],
  clipSpeeds: Record<string, number>,
): Clip[] {
  if (silenceRegions.length === 0) return clips

  const timings = getClipTimings(clips, clipSpeeds)
  const result: Clip[] = []

  for (const timing of timings) {
    const { clip, start: tStart, end: tEnd } = timing
    const speed = clipSpeeds[clip.id] ?? 1

    const overlapping = silenceRegions
      .filter(r => r.end > tStart + 0.001 && r.start < tEnd - 0.001)
      .sort((a, b) => a.start - b.start)

    if (overlapping.length === 0) { result.push(clip); continue }

    // Convert timeline position back to source file position
    const toSource = (t: number) => clip.trimStart + (t - tStart) * speed

    let cursor = tStart
    for (const silence of overlapping) {
      const silStart = Math.max(tStart, silence.start)
      const silEnd   = Math.min(tEnd,   silence.end)

      if (cursor < silStart) {
        const trimStart = toSource(cursor)
        const trimEnd   = toSource(silStart)
        if ((trimEnd - trimStart) / speed >= MIN_CLIP_DURATION) {
          result.push({ ...clip, id: crypto.randomUUID(), trimStart, trimEnd })
        }
      }
      cursor = silEnd
    }

    if (cursor < tEnd) {
      const trimStart = toSource(cursor)
      const trimEnd   = toSource(tEnd)
      if ((trimEnd - trimStart) / speed >= MIN_CLIP_DURATION) {
        result.push({ ...clip, id: crypto.randomUUID(), trimStart, trimEnd })
      }
    }
  }

  return result
}
