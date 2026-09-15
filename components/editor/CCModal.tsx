'use client'

import { useState } from 'react'
import { useEditorStore } from '@/store/store'
import { extractAudioChunks } from '@/lib/audioUtils'
import { WHISPER_SUPPORTED_LANGUAGES, getLanguageName } from '@/lib/languages'
import { Project } from '@/types'

interface Props {
  project: Project
  onClose: () => void
}

const LANGUAGE_OPTIONS = [
  { value: 'original', label: 'Original (auto-detect)' },
  { value: 'English',  label: 'English' },
  ...Object.values(WHISPER_SUPPORTED_LANGUAGES)
    .filter(name => name !== 'English')
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ value: name, label: name })),
]

export default function CCModal({ project, onClose }: Props) {
  const setSourceTranscript    = useEditorStore(s => s.setSourceTranscript)
  const setSourceTranslation   = useEditorStore(s => s.setSourceTranslation)
  const clearSourceTranslation = useEditorStore(s => s.clearSourceTranslation)

  const source        = project.sources[0]
  const hasTranscript = !!(source?.transcript?.length)
  const currentLang   = source?.translationLanguage ?? 'original'

  const [selectedLang, setSelectedLang]       = useState(currentLang)
  const [phase, setPhase]                     = useState<'idle' | 'transcribing' | 'translating'>('idle')
  const [error, setError]                     = useState<string | null>(null)
  const [showSupportedLangs, setShowSupportedLangs] = useState(false)

  const busy      = phase !== 'idle'
  const isFirst   = !hasTranscript
  const btnLabel  = busy
    ? phase === 'transcribing' ? 'Transcribing…' : 'Translating…'
    : isFirst ? 'Generate' : 'Update'

  async function handleSubmit() {
    if (!source) return
    setError(null)

    let transcript   = source.transcript ?? []
    let detectedLang = source.detectedLanguage

    // Always transcribe when Original is selected (fresh transcription)
    // Also transcribe when no transcript exists yet
    const shouldTranscribe = selectedLang === 'original' || !hasTranscript

    if (shouldTranscribe) {
      setPhase('transcribing')
      try {
        const chunks     = await extractAudioChunks(source.objectUrl)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allSegments: any[] = []
        let lang: string | undefined

        for (const chunk of chunks) {
          const form = new FormData()
          form.append('audio', chunk.blob, 'audio.wav')
          const res = await fetch('/api/transcribe', { method: 'POST', body: form })
          if (!res.ok) {
            const { error: e } = await res.json()
            throw new Error(e ?? 'Transcription failed')
          }
          const { segments, language } = await res.json()
          if (!lang) lang = language  // capture from first chunk
          for (const seg of segments) {
            allSegments.push({
              ...seg,
              start: seg.start + chunk.offset,
              end:   seg.end   + chunk.offset,
              words: (seg.words ?? []).map((w: { word: string; start: number; end: number }) => ({
                ...w,
                start: w.start + chunk.offset,
                end:   w.end   + chunk.offset,
              })),
            })
          }
        }

        setSourceTranscript(source.id, allSegments, lang)
        clearSourceTranslation(source.id)
        transcript   = allSegments
        detectedLang = lang
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed')
        setPhase('idle')
        return
      }

      // Original selected — done after transcription
      if (selectedLang === 'original') {
        setPhase('idle')
        onClose()
        return
      }
    }

    // Translate if a non-original language is selected
    setPhase('translating')
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: transcript,
          targetLanguage: selectedLang,
          sourceLanguage: detectedLang ? getLanguageName(detectedLang) : undefined,
        }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        throw new Error(e ?? 'Translation failed')
      }
      const { segments } = await res.json()
      setSourceTranslation(source.id, selectedLang, segments)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
      setPhase('idle')
      return
    }

    setPhase('idle')
    onClose()
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-96 p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            {isFirst ? 'Add Closed Captions' : 'Edit Closed Captions'}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-neutral-500 hover:text-white transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>

        {/* Language selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-neutral-400">Choose your CC language</label>
          <select
            value={selectedLang}
            onChange={e => setSelectedLang(e.target.value)}
            disabled={busy}
            className="text-sm bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-500 disabled:opacity-50"
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2 bg-neutral-800/60 rounded-lg p-3">
          <div className="flex gap-2">
            <span className="text-neutral-500 text-xs mt-px shrink-0">1.</span>
            <p className="text-xs text-neutral-400">
              CC is generated only for{' '}
              <button
                onClick={() => setShowSupportedLangs(true)}
                className="text-blue-400 hover:underline focus:outline-none"
              >
                Supported Languages
              </button>
              . Unsupported languages will not have CC.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="text-neutral-500 text-xs mt-px shrink-0">2.</span>
            <p className="text-xs text-neutral-400">
              Word highlight CC is not available for translated captions — Standard CC will be used instead.
            </p>
          </div>
        </div>

        {/* Detected language (if known) */}
        {source?.detectedLanguage && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Detected language</span>
            <span className="text-xs text-emerald-400">
              {getLanguageName(source.detectedLanguage)}
            </span>
          </div>
        )}

        {/* Active translation (if any) */}
        {source?.translationLanguage && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Current CC language</span>
            <span className="text-xs text-violet-400">→ {source.translationLanguage}</span>
          </div>
        )}

        {/* Progress indicator */}
        {busy && (
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-neutral-600 border-t-blue-400 rounded-full animate-spin shrink-0" />
            <span className="text-xs text-neutral-400">
              {phase === 'transcribing' ? 'Transcribing audio…' : 'Translating captions…'}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Divider */}
        <div className="h-px bg-neutral-800" />

        {/* Action */}
        <button
          onClick={handleSubmit}
          disabled={busy}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
            busy
              ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {btnLabel}
        </button>
      </div>
    </div>

    {/* Supported languages sub-modal */}

    {showSupportedLangs && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
        onClick={() => setShowSupportedLangs(false)}
      >
        <div
          className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-80 p-5 flex flex-col gap-3 max-h-[70vh]"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between shrink-0">
            <h3 className="text-sm font-semibold text-white">Supported Languages</h3>
            <button
              onClick={() => setShowSupportedLangs(false)}
              className="text-neutral-500 hover:text-white transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="overflow-y-auto flex flex-col gap-0.5">
            {Object.values(WHISPER_SUPPORTED_LANGUAGES)
              .sort((a, b) => a.localeCompare(b))
              .map(name => (
                <div key={name} className="text-xs text-neutral-300 py-1 px-2 rounded hover:bg-neutral-800">
                  {name}
                </div>
              ))
            }
          </div>
        </div>
      </div>
    )}
    </>
  )
}
