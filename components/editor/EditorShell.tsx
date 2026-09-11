'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/store'
import { extractAudioChunks } from '@/lib/audioUtils'
import Preview from './Preview'
import Toolbar from './Toolbar'
import Timeline from './Timeline'
import FormatSelector from './FormatSelector'
import ExportPanel from './ExportPanel'

interface Props {
  projectId: string
}

export default function EditorShell({ projectId }: Props) {
  const router = useRouter()
  const projects = useEditorStore(s => s.projects)
  const setActiveProject = useEditorStore(s => s.setActiveProject)
  const setSourceTranscript = useEditorStore(s => s.setSourceTranscript)

  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)

  const project = projects.find(p => p.id === projectId)

  useEffect(() => {
    if (!project) {
      router.replace('/')
      return
    }
    setActiveProject(projectId)
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return

      const s = useEditorStore.getState()
      const audioMode   = !!s.selectedAudioLayerId
      const overlayMode = !!s.selectedOverlayId

      if (e.key === ' ') {
        e.preventDefault()
        s.setPlaying(!s.isPlaying)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const nudge = e.shiftKey ? 1 : 0.1
        const dir   = e.key === 'ArrowLeft' ? -1 : 1
        s.setPlaying(false)
        s.setPlayhead(Math.max(0, s.playheadTime + dir * nudge))
      } else if (e.key === 'Escape') {
        s.clearSelection()
        s.setSelectedAudioLayerId(null)
        s.setSelectedOverlayId(null)
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        if (!overlayMode) audioMode ? s.splitAudioLayer() : s.split()
      } else if (e.key === 'm' && !e.metaKey && !e.ctrlKey) {
        if (!audioMode && !overlayMode) s.merge()
      } else if (e.key === 'x' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        overlayMode ? s.cutOverlayLayer() : audioMode ? s.cutAudioLayer() : s.cut()
      } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        overlayMode ? s.copyOverlayLayer() : audioMode ? s.copyAudioLayer() : s.copy()
      } else if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        overlayMode || s.overlayClipboard
          ? s.pasteOverlayLayer()
          : audioMode ? s.pasteAudioLayer() : s.paste()
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        overlayMode ? s.duplicateOverlayLayer() : audioMode ? s.duplicateAudioLayer() : s.duplicate()
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        s.undo()
      } else if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) || (e.key === 'y' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        s.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (overlayMode) s.removeOverlayLayer(s.selectedOverlayId!)
        else if (audioMode) s.removeAudioLayer(s.selectedAudioLayerId!)
        else s.deleteSelected()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasTranscript = project?.sources.some(s => s.transcript && s.transcript.length > 0)

  async function handleTranscribe() {
    if (!project) return
    setTranscribing(true)
    setTranscribeError(null)
    try {
      for (const source of project.sources) {
        const chunks = await extractAudioChunks(source.objectUrl)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allSegments: any[] = []

        for (const chunk of chunks) {
          const form = new FormData()
          form.append('audio', chunk.blob, 'audio.wav')
          const res = await fetch('/api/transcribe', { method: 'POST', body: form })
          if (!res.ok) {
            const { error } = await res.json()
            throw new Error(error ?? 'Transcription failed')
          }
          const { segments } = await res.json()
          // Shift all timestamps by the chunk's start offset
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

        setSourceTranscript(source.id, allSegments)
      }
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setTranscribing(false)
    }
  }

  if (!project) return null

  return (
    <div className="flex flex-col h-screen bg-neutral-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
        <button
          onClick={() => router.push('/')}
          className="text-neutral-400 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <span className="w-px h-4 bg-neutral-700" />
        <h1 className="text-sm font-medium text-neutral-200 truncate">{project.name}</h1>
        <div className="ml-auto flex items-center gap-3">
          <FormatSelector />

          {/* Transcribe */}
          <div className="flex flex-col items-end">
            <button
              onClick={handleTranscribe}
              disabled={transcribing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                transcribing
                  ? 'border-neutral-700 text-neutral-500 cursor-not-allowed'
                  : hasTranscript
                  ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                  : 'border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-300'
              }`}
            >
              {transcribing ? (
                <>
                  <span className="w-3 h-3 border border-neutral-500 border-t-neutral-300 rounded-full animate-spin" />
                  Transcribing…
                </>
              ) : hasTranscript ? 'Re-transcribe' : 'Transcribe'}
            </button>
            {transcribeError && (
              <span className="text-[10px] text-red-400 mt-0.5">{transcribeError}</span>
            )}
          </div>

          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            Export
          </button>

          <span className="text-xs text-neutral-600">{project.clips.length} clip{project.clips.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      {/* Preview */}
      <div className="flex-1 min-h-0">
        <Preview />
      </div>

      {/* Toolbar */}
      <Toolbar />

      {/* Timeline */}
      <div className="shrink-0">
        <Timeline />
      </div>

      {showExport && <ExportPanel onClose={() => setShowExport(false)} />}
    </div>
  )
}
