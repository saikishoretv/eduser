const TARGET_RATE = 16_000
// 110 s × 16 000 Hz × 2 bytes ≈ 3.4 MB — safely under Vercel's 4.5 MB payload limit
const CHUNK_SECS = 110

/**
 * Splits a video/audio objectUrl into ≤110-second WAV chunks resampled to
 * 16 kHz mono. Each chunk is labelled with its start offset (seconds) so
 * that transcript timestamps can be adjusted after transcription.
 */
export async function extractAudioChunks(
  objectUrl: string,
): Promise<Array<{ blob: Blob; offset: number }>> {
  const response = await fetch(objectUrl)
  const arrayBuffer = await response.arrayBuffer()

  const tempCtx = new AudioContext()
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer)
  await tempCtx.close()

  const duration = audioBuffer.duration
  const chunks: Array<{ blob: Blob; offset: number }> = []

  for (let start = 0; start < duration; start += CHUNK_SECS) {
    const chunkDuration = Math.min(CHUNK_SECS, duration - start)
    const numSamples = Math.ceil(chunkDuration * TARGET_RATE)
    const offlineCtx = new OfflineAudioContext(1, numSamples, TARGET_RATE)
    const src = offlineCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(offlineCtx.destination)
    src.start(0, start) // play from `start` seconds into the source buffer
    const rendered = await offlineCtx.startRendering()
    const samples = rendered.getChannelData(0)
    chunks.push({
      blob: new Blob([encodeWav(samples, TARGET_RATE)], { type: 'audio/wav' }),
      offset: start,
    })
  }

  return chunks
}

/** @deprecated Use extractAudioChunks instead */
export async function extractAudioAsWav(objectUrl: string): Promise<Blob> {
  const chunks = await extractAudioChunks(objectUrl)
  return chunks[0].blob
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)

  const str = (off: number, s: string) =>
    s.split('').forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)))

  str(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)        // chunk size
  view.setUint16(20, 1, true)         // PCM
  view.setUint16(22, 1, true)         // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true)         // block align
  view.setUint16(34, 16, true)        // bits per sample
  str(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buf
}
