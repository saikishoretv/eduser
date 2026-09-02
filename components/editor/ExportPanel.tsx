'use client'

import { useState, useCallback, useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { exportVideo } from '@/lib/export'

interface Props {
  onClose: () => void
}

export default function ExportPanel({ onClose }: Props) {
  const clips                   = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? [])
  const sources                 = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.sources ?? [])
  const audioLayers             = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.audioLayers ?? [])
  const overlayLayers           = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.overlayLayers ?? [])
  const outputFormat            = useEditorStore(s => s.outputFormat)
  const clipCrops               = useEditorStore(s => s.clipCrops)
  const clipZooms               = useEditorStore(s => s.clipZooms)
  const clipColorCorrections    = useEditorStore(s => s.clipColorCorrections)
  const subtitleStyle           = useEditorStore(s => s.subtitleStyle)
  const subtitleAppearance      = useEditorStore(s => s.subtitleAppearance)
  const standardSubtitleAppearance = useEditorStore(s => s.standardSubtitleAppearance)

  const hasTranscript  = sources.some(s => s.transcript?.length)
  const canBurnSubs    = hasTranscript && subtitleStyle !== 'off'

  const [resolution, setResolution] = useState<720 | 1080>(1080)
  const [burnSubtitles, setBurnSubtitles] = useState(canBurnSubs)

  // Keep toggle in sync if CC mode changes while panel is open
  useEffect(() => {
    if (canBurnSubs) setBurnSubtitles(true)
  }, [canBurnSubs])
  const [phase, setPhase] = useState<'idle' | 'loading' | 'exporting' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = useCallback(async () => {
    setPhase('loading')
    setProgress(0)
    setError(null)
    try {
      const blob = await exportVideo({
        clips,
        sources,
        audioLayers,
        overlayLayers,
        outputFormat,
        clipCrops,
        clipZooms,
        clipColorCorrections,
        resolution,
        subtitleStyle: burnSubtitles ? subtitleStyle : 'off',
        subtitleAppearance,
        standardSubtitleAppearance,
        onProgress: (ratio) => {
          setPhase('exporting')
          setProgress(ratio)
        },
      })
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setPhase('error')
    }
  }, [clips, sources, audioLayers, overlayLayers, outputFormat, clipCrops, clipZooms, clipColorCorrections, resolution, burnSubtitles, subtitleStyle, subtitleAppearance, standardSubtitleAppearance])

  const handleDownload = () => {
    if (!downloadUrl) return
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = 'export.mp4'
    a.click()
  }

  const busy = phase === 'loading' || phase === 'exporting'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-80 p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Export</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors text-lg leading-none">×</button>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-3">
          {/* Resolution */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Resolution</span>
            <div className="flex rounded-lg overflow-hidden border border-neutral-700">
              {([720, 1080] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  disabled={busy}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    resolution === r
                      ? 'bg-blue-600 text-white'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
                  }`}
                >
                  {r}p
                </button>
              ))}
            </div>
          </div>

          {/* Format display */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Format</span>
            <span className="text-xs text-neutral-300">
              {outputFormat ? `${outputFormat.label} (${outputFormat.aspectW}:${outputFormat.aspectH})` : 'Original'}
            </span>
          </div>

          {/* Subtitles */}
          {subtitleStyle !== 'off' && (
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-neutral-400">Burn subtitles</span>
                <span className="text-[10px] text-neutral-600">
                  {subtitleStyle === 'standard' ? 'Standard' : 'Word Highlight'}
                </span>
              </div>
              {!hasTranscript ? (
                <span className="text-[10px] text-amber-500">Transcribe first</span>
              ) : (
                <button
                  onClick={() => setBurnSubtitles(v => !v)}
                  disabled={busy}
                  className={`w-9 h-5 rounded-full transition-colors relative ${burnSubtitles ? 'bg-blue-600' : 'bg-neutral-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${burnSubtitles ? 'left-4' : 'left-0.5'}`} />
                </button>
              )}
            </div>
          )}

          {/* Clip count */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Clips</span>
            <span className="text-xs text-neutral-300">{clips.length}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-neutral-800" />

        {/* Progress */}
        {(phase === 'loading' || phase === 'exporting') && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400">
                {phase === 'loading' ? 'Loading FFmpeg…' : 'Exporting…'}
              </span>
              <span className="text-xs text-neutral-400 tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'error' && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Actions */}
        {phase === 'done' ? (
          <button
            onClick={handleDownload}
            className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
          >
            Download MP4
          </button>
        ) : (
          <button
            onClick={handleExport}
            disabled={busy || clips.length === 0}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              busy || clips.length === 0
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {busy ? 'Working…' : 'Export'}
          </button>
        )}
      </div>
    </div>
  )
}
