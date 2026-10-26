export const TTS_VOICES = [
  { id: 'af_heart',    label: 'Heart (US F)'    },
  { id: 'af_bella',    label: 'Bella (US F)'    },
  { id: 'am_adam',     label: 'Adam (US M)'     },
  { id: 'am_michael',  label: 'Michael (US M)'  },
  { id: 'bf_emma',     label: 'Emma (UK F)'     },
  { id: 'bm_george',   label: 'George (UK M)'   },
] as const

export type TtsVoice = (typeof TTS_VOICES)[number]['id']

export interface TtsResult {
  blob:     Blob
  duration: number
}

let worker: Worker | null = null
let pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./tts-worker.ts', import.meta.url))
  worker.onmessage = (e: MessageEvent) => {
    const { id, success, buffer, error } = e.data
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (success) {
      p.resolve(new Blob([buffer], { type: 'audio/wav' }))
    } else {
      p.reject(new Error(error ?? 'TTS failed'))
    }
  }
  worker.onerror = (e) => {
    const err = new Error(e.message)
    pending.forEach(p => p.reject(err))
    pending.clear()
    worker = null
  }
  return worker
}

function generateLocal(text: string, voice: TtsVoice): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, text, voice })
  })
}

async function decodeAudioDuration(blob: Blob): Promise<number> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx    = new AudioContext()
  try {
    const buf = await audioCtx.decodeAudioData(arrayBuffer)
    return buf.duration
  } finally {
    await audioCtx.close()
  }
}

function isEnglish(language?: string): boolean {
  if (!language) return true
  return language.toLowerCase().startsWith('en')
}

export async function generateSpeech(text: string, voice: TtsVoice, language?: string): Promise<TtsResult> {
  if (isEnglish(language)) {
    const blob     = await generateLocal(text, voice)
    const duration = blob.size / 2 / 24000   // 16-bit mono 24kHz WAV
    return { blob, duration }
  }

  // Non-English: call server-side cloud TTS
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  })

  if (res.status === 402) {
    const { error } = await res.json()
    throw new Error(error)
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'TTS failed' }))
    throw new Error(error)
  }

  const blob     = await res.blob()
  const duration = await decodeAudioDuration(blob)
  return { blob, duration }
}

// Pre-warms the Kokoro worker (English only). No-op for cloud TTS.
export function warmUpTTS(): void {
  getWorker()
}
