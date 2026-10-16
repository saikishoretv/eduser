'use client'

import { useState } from 'react'
import { useEditorStore } from '@/store/store'
import { extractAudioChunks } from '@/lib/audioUtils'
import { WHISPER_SUPPORTED_LANGUAGES, getLanguageName } from '@/lib/languages'
import { getClipTimings } from '@/lib/clipUtils'
import { Project, CcSegment, TranscriptSegment, AudioLayer } from '@/types'

const EMPTY_CC_SEGMENTS: CcSegment[] = []

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

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function computeCcSegments(
  project: Project,
  clipSpeeds: Record<string, number>,
  sourceId: string,
  transcript: TranscriptSegment[],
): CcSegment[] {
  const timings = getClipTimings(project.clips, clipSpeeds)
  const segments: CcSegment[] = []
  for (const timing of timings) {
    if (timing.clip.sourceId !== sourceId) continue
    const speed = clipSpeeds[timing.clip.id] ?? 1
    const toTimeline = (src: number) => timing.start + (src - timing.clip.trimStart) / speed
    for (const seg of transcript) {
      if (seg.end <= timing.clip.trimStart || seg.start >= timing.clip.trimEnd) continue
      segments.push({
        id: crypto.randomUUID(),
        text: seg.text,
        startAt: toTimeline(Math.max(seg.start, timing.clip.trimStart)),
        endAt:   toTimeline(Math.min(seg.end,   timing.clip.trimEnd)),
        words: seg.words
          ?.filter(w => w.end > timing.clip.trimStart && w.start < timing.clip.trimEnd)
          .map(w => ({
            word:    w.word,
            startAt: toTimeline(Math.max(w.start, timing.clip.trimStart)),
            endAt:   toTimeline(Math.min(w.end,   timing.clip.trimEnd)),
          })),
      })
    }
  }
  return segments
}

function computeCcSegmentsForAudioLayer(
  layer: AudioLayer,
  transcript: TranscriptSegment[],
): CcSegment[] {
  const segments: CcSegment[] = []
  const toTimeline = (src: number) => layer.startAt + (src - layer.trimStart)
  for (const seg of transcript) {
    if (seg.end <= layer.trimStart || seg.start >= layer.trimEnd) continue
    segments.push({
      id: crypto.randomUUID(),
      text: seg.text,
      startAt: toTimeline(Math.max(seg.start, layer.trimStart)),
      endAt:   toTimeline(Math.min(seg.end,   layer.trimEnd)),
      words: seg.words
        ?.filter(w => w.end > layer.trimStart && w.start < layer.trimEnd)
        .map(w => ({
          word:    w.word,
          startAt: toTimeline(Math.max(w.start, layer.trimStart)),
          endAt:   toTimeline(Math.min(w.end,   layer.trimEnd)),
        })),
    })
  }
  return segments
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transcribeUrl(objectUrl: string): Promise<{ segments: any[]; language: string | undefined }> {
  const chunks = await extractAudioChunks(objectUrl)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSegments: any[] = []
  let language: string | undefined
  for (const chunk of chunks) {
    const form = new FormData()
    form.append('audio', chunk.blob, 'audio.wav')
    const res = await fetch('/api/transcribe', { method: 'POST', body: form })
    if (!res.ok) {
      const { error: e } = await res.json()
      throw new Error(e ?? 'Transcription failed')
    }
    const { segments, language: lang } = await res.json()
    if (!language) language = lang
    for (const seg of segments) {
      allSegments.push({
        ...seg,
        start: seg.start + chunk.offset,
        end:   seg.end   + chunk.offset,
        words: (seg.words ?? []).map((w: { word: string; start: number; end: number }) => ({
          ...w, start: w.start + chunk.offset, end: w.end + chunk.offset,
        })),
      })
    }
  }
  return { segments: allSegments, language }
}

export default function CCModal({ project, onClose }: Props) {
  const setSourceTranscript    = useEditorStore(s => s.setSourceTranscript)
  const setSourceTranslation   = useEditorStore(s => s.setSourceTranslation)
  const clearSourceTranslation = useEditorStore(s => s.clearSourceTranslation)
  const setCcSegments          = useEditorStore(s => s.setCcSegments)
  const updateCcSegment        = useEditorStore(s => s.updateCcSegment)
  const deleteCcSegment        = useEditorStore(s => s.deleteCcSegment)
  const clipSpeeds             = useEditorStore(s => s.clipSpeeds)
  const ccSegments             = useEditorStore(s => s.projects.find(p => p.id === project.id)?.ccSegments ?? EMPTY_CC_SEGMENTS)

  // Video layer: unique sources actually used in clips, with audio
  const videoSourcesUsed = project.sources.filter(s =>
    !s.isImage && s.hasAudio !== false &&
    project.clips.some(c => c.sourceId === s.id)
  )
  const hasVideoLayer = videoSourcesUsed.length > 0

  // Audio tracks: group independent audio layers by trackIndex
  const audioOnlyLayers = (project.audioLayers ?? []).filter(l => !l.detachedFromSourceId && !!l.objectUrl)
  const audioTrackIndices = [...new Set(audioOnlyLayers.map(l => l.trackIndex))].sort((a, b) => a - b)
  const audioTracks = audioTrackIndices.map(idx => ({
    trackIndex: idx,
    label: audioTrackIndices.length === 1 ? 'Audio' : `Audio ${idx + 1}`,
    layers: audioOnlyLayers.filter(l => l.trackIndex === idx),
  }))

  const [videoSelected, setVideoSelected] = useState(hasVideoLayer)
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<Set<number>>(new Set())

  const totalSelected = (videoSelected ? 1 : 0) + selectedTrackIndices.size
  const multiMode = totalSelected > 1

  const primaryVideoOnly = videoSelected && selectedTrackIndices.size === 0 && videoSourcesUsed.length === 1
  const primarySource = primaryVideoOnly ? videoSourcesUsed[0] : null

  const currentLang = primarySource?.translationLanguage ?? 'original'
  const [selectedLang, setSelectedLang] = useState(currentLang)

  const [phase, setPhase]                           = useState<'idle' | 'transcribing' | 'translating'>('idle')
  const [transcribingLabel, setTranscribingLabel]   = useState('')
  const [error, setError]                           = useState<string | null>(null)
  const [showSupportedLangs, setShowSupportedLangs] = useState(false)
  const [editingId, setEditingId]                   = useState<string | null>(null)
  const [editingText, setEditingText]               = useState('')
  const [hasEdits, setHasEdits]                     = useState(false)

  const hasCc      = ccSegments.length > 0
  const noneSelected = totalSelected === 0
  const busy       = phase !== 'idle'
  const btnLabel   = busy
    ? phase === 'transcribing' ? 'Transcribing…' : 'Translating…'
    : hasCc ? 'Regenerate' : 'Generate'

  function toggleTrack(idx: number) {
    setSelectedTrackIndices(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  async function handleSubmit() {
    if (noneSelected) return
    setError(null)

    const allCcSegments: CcSegment[] = []

    // --- Video layer ---
    if (videoSelected) {
      setPhase('transcribing')
      setTranscribingLabel('Video')
      try {
        for (const src of videoSourcesUsed) {
          const shouldTranscribe = selectedLang === 'original' || multiMode || !src.transcript?.length
          let transcript   = src.transcript ?? []
          let detectedLang = src.detectedLanguage

          if (shouldTranscribe) {
            const result = await transcribeUrl(src.objectUrl)
            setSourceTranscript(src.id, result.segments, result.language)
            clearSourceTranslation(src.id)
            transcript   = result.segments
            detectedLang = result.language
          }

          if (!multiMode && selectedLang !== 'original') {
            setPhase('translating')
            setTranscribingLabel('Video')
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
            const { segments: translated } = await res.json()
            setSourceTranslation(src.id, selectedLang, translated)
            allCcSegments.push(...computeCcSegments(project, clipSpeeds, src.id, translated))
          } else {
            allCcSegments.push(...computeCcSegments(project, clipSpeeds, src.id, transcript))
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
        setPhase('idle')
        return
      }
    }

    // --- Audio tracks ---
    for (const track of audioTracks.filter(t => selectedTrackIndices.has(t.trackIndex))) {
      setPhase('transcribing')
      setTranscribingLabel(track.label)
      try {
        for (const layer of track.layers) {
          const result = await transcribeUrl(layer.objectUrl)
          allCcSegments.push(...computeCcSegmentsForAudioLayer(layer, result.segments))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
        setPhase('idle')
        return
      }
    }

    allCcSegments.sort((a, b) => a.startAt - b.startAt)
    setCcSegments(project.id, allCcSegments)
    setHasEdits(false)
    setPhase('idle')
  }

  function commitEdit(id: string) {
    updateCcSegment(project.id, id, editingText)
    setEditingId(null)
    setHasEdits(true)
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-sm font-semibold text-white">Closed Captions</h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-neutral-500 hover:text-white transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>

        {/* Source picker */}
        {(hasVideoLayer || audioTracks.length > 0) && (
          <div className="px-5 pb-3 shrink-0 flex flex-col gap-1.5">
            <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Layers</p>
            {hasVideoLayer && (
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={videoSelected}
                  onChange={() => setVideoSelected(v => !v)}
                  disabled={busy}
                  className="accent-blue-500 shrink-0"
                />
                <span className="text-[11px] text-neutral-300 group-hover:text-white transition-colors">Video</span>
                <span className="text-[10px] text-neutral-600 shrink-0">
                  {videoSourcesUsed.length === 1 ? videoSourcesUsed[0].name : `${videoSourcesUsed.length} sources`}
                </span>
              </label>
            )}
            {audioTracks.map(track => (
              <label key={track.trackIndex} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedTrackIndices.has(track.trackIndex)}
                  onChange={() => toggleTrack(track.trackIndex)}
                  disabled={busy}
                  className="accent-emerald-500 shrink-0"
                />
                <span className="text-[11px] text-neutral-300 group-hover:text-white transition-colors">{track.label}</span>
                <span className="text-[10px] text-neutral-600 shrink-0">
                  {track.layers.length === 1 ? track.layers[0].name : `${track.layers.length} clips`}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Generate row */}
        <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
          <select
            value={multiMode ? 'original' : selectedLang}
            onChange={e => setSelectedLang(e.target.value)}
            disabled={busy || multiMode}
            title={multiMode ? 'Translation unavailable when multiple sources are selected' : undefined}
            className="flex-1 text-sm bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-neutral-500 disabled:opacity-50"
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={handleSubmit}
            disabled={busy || noneSelected}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
              busy || noneSelected
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {btnLabel}
          </button>
          <button
            onClick={() => setShowSupportedLangs(true)}
            disabled={multiMode}
            className="text-neutral-500 hover:text-neutral-300 transition-colors text-xs shrink-0 disabled:opacity-30"
            title="Supported languages"
          >
            ?
          </button>
        </div>

        {multiMode && (
          <p className="px-5 pb-2 text-[10px] text-neutral-600 shrink-0">
            Translation unavailable when multiple sources are selected
          </p>
        )}

        {/* Status row */}
        {(busy || error || primarySource?.detectedLanguage) && (
          <div className="px-5 pb-3 shrink-0 flex items-center gap-2">
            {busy && (
              <>
                <span className="w-3.5 h-3.5 border-2 border-neutral-600 border-t-blue-400 rounded-full animate-spin shrink-0" />
                <span className="text-xs text-neutral-400">
                  {phase === 'transcribing' ? `Transcribing ${transcribingLabel}…` : `Translating ${transcribingLabel}…`}
                </span>
              </>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            {!busy && !error && primarySource?.detectedLanguage && (
              <span className="text-xs text-neutral-500">
                Detected: <span className="text-emerald-400">{getLanguageName(primarySource.detectedLanguage)}</span>
                {primarySource.translationLanguage && (
                  <> → <span className="text-violet-400">{primarySource.translationLanguage}</span></>
                )}
              </span>
            )}
          </div>
        )}

        <div className="h-px bg-neutral-800 shrink-0" />

        {/* Segment list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {ccSegments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-5 text-center">
              <p className="text-sm text-neutral-500">No captions yet.</p>
              <p className="text-xs text-neutral-600 mt-1">Select sources above and click Generate.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-800">
              {ccSegments.map(seg => (
                <div key={seg.id} className="flex items-start gap-3 px-4 py-2.5 group hover:bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600 font-mono mt-0.5 shrink-0 w-20 tabular-nums">
                    {formatTime(seg.startAt)} → {formatTime(seg.endAt)}
                  </span>
                  {editingId === seg.id ? (
                    <input
                      autoFocus
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      onBlur={() => commitEdit(seg.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(seg.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 text-xs text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-2 py-0.5 focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <span
                      className="flex-1 text-xs text-neutral-300 cursor-text hover:text-white leading-snug"
                      onClick={() => { setEditingId(seg.id); setEditingText(seg.text) }}
                    >
                      {seg.text}
                    </span>
                  )}
                  <button
                    onClick={() => deleteCcSegment(project.id, seg.id)}
                    className="text-neutral-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 text-sm leading-none mt-0.5"
                    title="Delete segment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-800 shrink-0 flex items-center justify-between gap-3">
          {hasCc
            ? <p className="text-[10px] text-neutral-600">
                {hasEdits
                  ? 'Edited captions may have imprecise word highlights in karaoke mode'
                  : 'Click any caption to edit · hover to delete'}
              </p>
            : <span />
          }
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-neutral-700 hover:bg-neutral-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>

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
            <button onClick={() => setShowSupportedLangs(false)} className="text-neutral-500 hover:text-white transition-colors text-lg leading-none">×</button>
          </div>
          <div className="overflow-y-auto flex flex-col gap-0.5">
            {Object.values(WHISPER_SUPPORTED_LANGUAGES)
              .sort((a, b) => a.localeCompare(b))
              .map(name => (
                <div key={name} className="text-xs text-neutral-300 py-1 px-2 rounded hover:bg-neutral-800">{name}</div>
              ))
            }
          </div>
        </div>
      </div>
    )}
    </>
  )
}
