import { Clip, SourceVideo, AudioLayer } from '@/types'
import { getClipTimings } from '@/lib/clipUtils'

export interface SilenceRegion {
  start: number  // absolute timeline seconds
  end: number
}

export type TrackSource =
  | { type: 'video'; clips: Clip[]; sources: SourceVideo[]; clipSpeeds: Record<string, number> }
  | { type: 'audio'; layer: AudioLayer }

export interface SilenceDetectOptions {
  thresholdDb: number   // e.g. -40 — audio below this is treated as silence
  minDuration: number   // seconds — minimum pause length to report
  paddingMs: number     // ms to keep at each edge of a silence region (avoids jarring cuts)
}

const WINDOW_SEC = 0.05  // 50ms analysis windows
const EPSILON = 1e-10

function resolveUrl(objectUrl: string | undefined, s3Key: string | undefined): string {
  if (objectUrl) return objectUrl
  if (s3Key) return `/api/s3proxy?key=${encodeURIComponent(s3Key)}`
  throw new Error('No audio URL available for this track')
}

async function fetchAudioBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch audio (HTTP ${res.status})`)
  const arrayBuffer = await res.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    await ctx.close()
  }
}

// Returns silence regions in time relative to `fromSec`, in source file time.
function findSilence(
  buffer: AudioBuffer,
  fromSec: number,
  toSec: number,
  minDurationSourceSec: number,
  thresholdDb: number,
  paddingMs: number,
): Array<{ relStart: number; relEnd: number }> {
  const { sampleRate, numberOfChannels } = buffer
  const windowSize = Math.round(WINDOW_SEC * sampleRate)
  const fromSample = Math.round(fromSec * sampleRate)
  const toSample = Math.min(Math.round(toSec * sampleRate), buffer.length)

  const channels: Float32Array[] = []
  for (let c = 0; c < numberOfChannels; c++) channels.push(buffer.getChannelData(c))

  const regions: Array<{ relStart: number; relEnd: number }> = []
  let silenceStart: number | null = null

  const commit = (endSample: number) => {
    if (silenceStart === null) return
    const relStart = (silenceStart - fromSample) / sampleRate
    const relEnd   = (endSample   - fromSample) / sampleRate
    silenceStart = null
    if (relEnd - relStart < minDurationSourceSec) return
    const pad = paddingMs / 1000
    const trimmed = { relStart: relStart + pad, relEnd: relEnd - pad }
    if (trimmed.relEnd > trimmed.relStart + 0.01) regions.push(trimmed)
  }

  for (let s = fromSample; s < toSample; s += windowSize) {
    const end = Math.min(s + windowSize, toSample)
    let sumSq = 0, count = 0
    for (let i = s; i < end; i++) {
      for (const ch of channels) { sumSq += ch[i] * ch[i]; count++ }
    }
    const rms = Math.sqrt(sumSq / Math.max(count, 1))
    const db  = 20 * Math.log10(rms + EPSILON)

    if (db < thresholdDb) {
      if (silenceStart === null) silenceStart = s
    } else {
      commit(s)
    }
  }
  commit(toSample)

  return regions
}

export async function detectSilence(
  track: TrackSource,
  opts: SilenceDetectOptions,
): Promise<SilenceRegion[]> {
  const { thresholdDb, minDuration, paddingMs } = opts

  if (track.type === 'audio') {
    const { layer } = track
    const url    = resolveUrl(layer.objectUrl || undefined, layer.s3Key)
    const buffer = await fetchAudioBuffer(url)
    const raw    = findSilence(buffer, layer.trimStart, layer.trimEnd, minDuration, thresholdDb, paddingMs)
    return raw.map(r => ({
      start: layer.startAt + r.relStart,
      end:   layer.startAt + r.relEnd,
    }))
  }

  // Video track — group clips by sourceId to avoid re-fetching
  const { clips, sources, clipSpeeds } = track
  const timings = getClipTimings(clips, clipSpeeds)
  const bufferCache = new Map<string, AudioBuffer | null>()

  async function getBuffer(sourceId: string): Promise<AudioBuffer | null> {
    if (bufferCache.has(sourceId)) return bufferCache.get(sourceId)!
    const src = sources.find(s => s.id === sourceId)
    if (!src || src.hasAudio === false) { bufferCache.set(sourceId, null); return null }
    try {
      const url = resolveUrl(src.objectUrl || undefined, src.s3Key)
      const buf = await fetchAudioBuffer(url)
      bufferCache.set(sourceId, buf)
      return buf
    } catch {
      bufferCache.set(sourceId, null)
      return null
    }
  }

  const allRegions: SilenceRegion[] = []

  for (const timing of timings) {
    const { clip, start: tStart } = timing
    const speed = clipSpeeds[clip.id] ?? 1
    const buf = await getBuffer(clip.sourceId)
    if (!buf) continue

    const raw = findSilence(buf, clip.trimStart, clip.trimEnd, minDuration * speed, thresholdDb, paddingMs * speed)
    for (const r of raw) {
      allRegions.push({
        start: tStart + r.relStart / speed,
        end:   tStart + r.relEnd   / speed,
      })
    }
  }

  return allRegions.sort((a, b) => a.start - b.start)
}
