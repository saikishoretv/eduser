/**
 * Fetches a video/audio objectUrl, decodes it, resamples to 16 kHz mono,
 * and returns it as a WAV Blob suitable for the Whisper API.
 */
export async function extractAudioAsWav(objectUrl: string): Promise<Blob> {
  const response = await fetch(objectUrl)
  const arrayBuffer = await response.arrayBuffer()

  // Decode at the native sample rate
  const tempCtx = new AudioContext()
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer)
  await tempCtx.close()

  // Resample to 16 kHz mono (Whisper's optimal input format)
  const targetRate = 16_000
  const numSamples = Math.ceil(audioBuffer.duration * targetRate)
  const offlineCtx = new OfflineAudioContext(1, numSamples, targetRate)
  const src = offlineCtx.createBufferSource()
  src.buffer = audioBuffer
  src.connect(offlineCtx.destination)
  src.start()
  const resampled = await offlineCtx.startRendering()
  const samples = resampled.getChannelData(0)

  return new Blob([encodeWav(samples, targetRate)], { type: 'audio/wav' })
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
