import type { KokoroTTS } from 'kokoro-js'

let instance: KokoroTTS | null = null

async function getTTS(): Promise<KokoroTTS> {
  if (instance) return instance
  const { KokoroTTS } = await import('kokoro-js')
  instance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' })
  return instance
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf  = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const str  = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  str(0,  'RIFF');  view.setUint32(4,  36 + samples.length * 2, true)
  str(8,  'WAVE');  str(12, 'fmt ')
  view.setUint32(16, 16, true);   view.setUint16(20, 1, true)
  view.setUint16(22, 1, true);    view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  str(36, 'data');  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    off += 2
  }
  return buf
}

self.onmessage = async (e: MessageEvent) => {
  const { id, text, voice } = e.data
  try {
    const tts    = await getTTS()
    const result = await tts.generate(text, { voice })
    const buf    = encodeWav(result.audio as Float32Array, result.sampling_rate as number)
    ;(self as any).postMessage({ id, success: true, buffer: buf, size: buf.byteLength }, [buf])
  } catch (err: any) {
    ;(self as any).postMessage({ id, success: false, error: err?.message ?? String(err) })
  }
}
