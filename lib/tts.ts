export const TTS_VOICES = [
  { id: 'af_heart',    label: 'Heart (US F)'    },
  { id: 'af_bella',    label: 'Bella (US F)'    },
  { id: 'am_adam',     label: 'Adam (US M)'     },
  { id: 'am_michael',  label: 'Michael (US M)'  },
  { id: 'bf_emma',     label: 'Emma (UK F)'     },
  { id: 'bm_george',   label: 'George (UK M)'   },
] as const

export type TtsVoice = (typeof TTS_VOICES)[number]['id']

let worker: Worker | null = null
let pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./tts-worker.ts', import.meta.url))
  worker.onmessage = (e: MessageEvent) => {
    const { id, success, buffer, size, error } = e.data
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

export function generateSpeech(text: string, voice: TtsVoice): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, text, voice })
  })
}

// Pre-warms the worker so the model is loaded before the first generateSpeech call.
// Resolves when the worker is spawned (model loading continues in background).
export function warmUpTTS(): void {
  getWorker()
}
