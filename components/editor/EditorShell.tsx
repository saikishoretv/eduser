'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/store'
import Preview from './Preview'
import StepsPanel from './StepsPanel'
import Toolbar from './Toolbar'
import Timeline from './Timeline'
import FormatSelector from './FormatSelector'
import ExportPanel from './ExportPanel'
import CCModal from './CCModal'
import { useSourceCache } from '@/lib/useSourceCache'
import { useAutoSave } from '@/lib/useAutoSave'
import { getClipTimings } from '@/lib/clipUtils'
import { CcSegment, TranscriptSegment } from '@/types'
import { signOut, useSession } from '@/lib/auth-client'

interface Props {
  projectId: string
}

export default function EditorShell({ projectId }: Props) {
  const router = useRouter()
  const projects = useEditorStore(s => s.projects)
  const setActiveProject  = useEditorStore(s => s.setActiveProject)
  const hydrateProject    = useEditorStore(s => s.hydrateProject)
  const subtitleStyle    = useEditorStore(s => s.subtitleStyle)
  const setSubtitleStyle = useEditorStore(s => s.setSubtitleStyle)
  const undo             = useEditorStore(s => s.undo)
  const redo             = useEditorStore(s => s.redo)
  const canUndo          = useEditorStore(s => s.undoPast.length > 0)
  const canRedo          = useEditorStore(s => s.undoFuture.length > 0)
  const renameProject    = useEditorStore(s => s.renameProject)

  const [showCCModal,   setShowCCModal]   = useState(false)
  const [showCCWarning, setShowCCWarning] = useState(false)
  const [showExport,    setShowExport]    = useState(false)
  const [hydrating,     setHydrating]     = useState(false)
  const [editingName,   setEditingName]   = useState(false)
  const [nameValue,     setNameValue]     = useState('')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const { data: session } = useSession()
  const user = session?.user ?? null

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node))
        setShowUserMenu(false)
    }
    if (showUserMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showUserMenu])

  const project = projects.find(p => p.id === projectId)

  useEffect(() => {
    if (project) {
      setActiveProject(projectId)
      return
    }
    // Project not in local store — fetch full metadata from DB
    setHydrating(true)
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.project) {
          hydrateProject(data.project)
          setActiveProject(projectId)
        } else {
          router.replace('/')
        }
      })
      .catch(() => router.replace('/'))
      .finally(() => setHydrating(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve source objectUrls from IndexedDB or S3 after a page reload
  useSourceCache(project)

  // Debounce auto-save: 2s after last change → PATCH /api/projects/[id]
  useAutoSave(project ? projectId : null)

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
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        if (!overlayMode && !audioMode) s.requestFreezeFrame()
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

  const setCcSegments = useEditorStore(s => s.setCcSegments)
  const clipSpeeds    = useEditorStore(s => s.clipSpeeds)

  // Migrate: if a project has source.transcript but no ccSegments, compute them now
  useEffect(() => {
    if (!project) return
    if ((project.ccSegments?.length ?? 0) > 0) return
    const source = project.sources[0]
    const transcript: TranscriptSegment[] | undefined =
      source?.translatedTranscript ?? source?.transcript
    if (!transcript?.length) return

    const timings = getClipTimings(project.clips, clipSpeeds)
    const segments: CcSegment[] = []
    for (const timing of timings) {
      if (timing.clip.sourceId !== source.id) continue
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
    if (segments.length > 0) setCcSegments(project.id, segments)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.sources[0]?.transcript])

  const translationLanguage = project?.sources[0]?.translationLanguage ?? null
  const hasTranscript       = (project?.ccSegments?.length ?? 0) > 0

  // Auto-downgrade highlight CC to standard when a translation becomes active
  useEffect(() => {
    if (translationLanguage && subtitleStyle === 'highlight') {
      setSubtitleStyle('standard')
      setShowCCWarning(true)
    }
  }, [translationLanguage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss CC warning after 5s
  useEffect(() => {
    if (!showCCWarning) return
    const t = setTimeout(() => setShowCCWarning(false), 5000)
    return () => clearTimeout(t)
  }, [showCCWarning])

  if (!project) {
    return hydrating ? (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <span className="text-sm text-neutral-500">Loading project…</span>
      </div>
    ) : null
  }

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
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={() => {
              const trimmed = nameValue.trim()
              if (trimmed && trimmed !== project.name) renameProject(projectId, trimmed)
              setEditingName(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setEditingName(false) }
            }}
            className="text-sm font-medium text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-2 py-0.5 focus:outline-none focus:border-blue-500 w-48"
          />
        ) : (
          <h1
            onClick={() => { setNameValue(project.name); setEditingName(true) }}
            title="Click to rename"
            className="text-sm font-medium text-neutral-200 truncate cursor-text hover:text-white"
          >
            {project.name}
          </h1>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              aria-label="Undo"
              className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:text-neutral-700 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M3 13a9 9 0 1 0 2.83-6.36L3 7" />
              </svg>
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
              className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:text-neutral-700 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" />
                <path d="M21 13a9 9 0 1 1-2.83-6.36L21 7" />
              </svg>
            </button>
          </div>

          <FormatSelector />

          {/* CC button */}
          <div className="flex flex-col items-end">
            <button
              onClick={() => setShowCCModal(true)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                hasTranscript
                  ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                  : 'border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-300'
              }`}
            >
              {hasTranscript ? 'Edit CC' : 'Add CC'}
            </button>
            {hasTranscript && translationLanguage && (
              <span className="text-[10px] text-violet-400 mt-0.5">→ {translationLanguage}</span>
            )}
          </div>

          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            Export
          </button>

          <span className="text-xs text-neutral-600">{project.clips.length} clip{project.clips.length !== 1 ? 's' : ''}</span>

          {/* User menu */}
          {user && (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="w-7 h-7 rounded-full bg-neutral-700 hover:bg-neutral-600 text-white text-xs font-semibold flex items-center justify-center transition-colors"
                title={user.email}
              >
                {user.email[0].toUpperCase()}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-9 w-52 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden z-50">
                  <div className="px-3 py-2.5 border-b border-neutral-700">
                    <p className="text-[11px] text-neutral-500 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); router.push('/settings') }}
                    className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
                  >
                    Settings
                  </button>
                  <button
                    onClick={async () => { await signOut(); window.location.href = '/login' }}
                    className="w-full text-left px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-red-400 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* CC downgrade warning */}
      {showCCWarning && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-950 border-b border-amber-800 shrink-0">
          <span className="text-xs text-amber-300">
            Word highlight CC is not available for translations — switched to Standard CC.
          </span>
          <button
            onClick={() => setShowCCWarning(false)}
            className="text-amber-600 hover:text-amber-300 text-sm leading-none shrink-0 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* Preview area: steps panel (30%) + video preview */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {project.steps && (
          <StepsPanel projectId={projectId} />
        )}
        <div className="flex-1 min-w-0 min-h-0">
          <Preview />
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar />

      {/* Timeline */}
      <div className="shrink-0">
        <Timeline />
      </div>

      {showExport  && <ExportPanel onClose={() => setShowExport(false)} />}
      {showCCModal && <CCModal project={project} onClose={() => setShowCCModal(false)} />}
    </div>
  )
}
