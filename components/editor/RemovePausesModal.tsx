'use client'

import { useState } from 'react'
import { useEditorStore } from '@/store/store'
import { detectSilence, SilenceRegion, TrackSource } from '@/lib/silenceDetect'
import { applySilenceCuts } from '@/lib/applySilenceCuts'

interface Props {
  onClose: () => void
}

const SENSITIVITY_PRESETS = [
  { label: 'Subtle',     db: -50, hint: 'Only very quiet gaps' },
  { label: 'Balanced',   db: -40, hint: 'Recommended'          },
  { label: 'Aggressive', db: -30, hint: 'Cuts more pauses'     },
] as const

type Sensitivity = typeof SENSITIVITY_PRESETS[number]['label']

function fmt(s: number): string {
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`
}

export default function RemovePausesModal({ onClose }: Props) {
  const activeProjectId = useEditorStore(s => s.activeProjectId)
  const projects        = useEditorStore(s => s.projects)
  const clipSpeeds      = useEditorStore(s => s.clipSpeeds)
  const applyPauseCuts  = useEditorStore(s => s.applyPauseCuts)

  const project = projects.find(p => p.id === activeProjectId) ?? null
  const audioLayers = project?.audioLayers ?? []

  // 'video' or an audioLayer id
  const [selectedTrack, setSelectedTrack] = useState<string>('video')
  const [sensitivity, setSensitivity]     = useState<Sensitivity>('Balanced')
  const [minDuration, setMinDuration]     = useState(0.5)

  const [analyzing, setAnalyzing]         = useState(false)
  const [regions, setRegions]             = useState<SilenceRegion[] | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  if (!project) return null

  const thresholdDb = SENSITIVITY_PRESETS.find(p => p.label === sensitivity)!.db

  async function handleAnalyze() {
    setAnalyzing(true)
    setRegions(null)
    setError(null)
    try {
      let track: TrackSource
      if (selectedTrack === 'video') {
        track = { type: 'video', clips: project!.clips, sources: project!.sources, clipSpeeds }
      } else {
        const layer = audioLayers.find(l => l.id === selectedTrack)
        if (!layer) throw new Error('Audio layer not found')
        track = { type: 'audio', layer }
      }
      const found = await detectSilence(track, { thresholdDb, minDuration, paddingMs: 50 })
      setRegions(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  function handleApply() {
    if (!regions) return
    const newClips = applySilenceCuts(project!.clips, regions, clipSpeeds)
    applyPauseCuts(newClips)
    onClose()
  }

  const totalCut = regions ? regions.reduce((s, r) => s + (r.end - r.start), 0) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-full max-w-md mx-4 flex flex-col gap-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm">Remove Pauses</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors text-lg leading-none">×</button>
        </div>

        {/* Track selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-neutral-400 font-medium">Analyze track</label>
          <select
            value={selectedTrack}
            onChange={e => { setSelectedTrack(e.target.value); setRegions(null) }}
            className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white cursor-pointer focus:outline-none focus:border-neutral-400"
          >
            <option value="video">Video (embedded audio)</option>
            {audioLayers.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Sensitivity */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-neutral-400 font-medium">Sensitivity</label>
          <div className="flex gap-2">
            {SENSITIVITY_PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => { setSensitivity(preset.label); setRegions(null) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                  sensitivity === preset.label
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:border-neutral-500'
                }`}
              >
                {preset.label}
                <span className="block text-[10px] mt-0.5 opacity-60">{preset.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Min pause duration */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between">
            <label className="text-xs text-neutral-400 font-medium">Minimum pause length</label>
            <span className="text-xs text-neutral-300 tabular-nums">{minDuration.toFixed(1)}s</span>
          </div>
          <input
            type="range" min={0.2} max={2.0} step={0.1}
            value={minDuration}
            onChange={e => { setMinDuration(parseFloat(e.target.value)); setRegions(null) }}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-neutral-600">
            <span>0.2s</span>
            <span>2.0s</span>
          </div>
        </div>

        {/* Results */}
        {regions !== null && (
          <div className={`rounded-xl px-4 py-3 text-sm ${regions.length === 0 ? 'bg-neutral-800 text-neutral-400' : 'bg-blue-950 border border-blue-800 text-blue-200'}`}>
            {regions.length === 0
              ? 'No pauses found with these settings.'
              : <>Found <span className="font-semibold">{regions.length} pause{regions.length !== 1 ? 's' : ''}</span> totalling <span className="font-semibold">{fmt(totalCut)}</span>.</>
            }
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors border border-neutral-600 text-neutral-200 hover:border-neutral-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
          <button
            onClick={handleApply}
            disabled={!regions || regions.length === 0}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply Cuts
          </button>
        </div>
      </div>
    </div>
  )
}
