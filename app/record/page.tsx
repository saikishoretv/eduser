'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ScreenRecorder } from '@/lib/recorder'
import { useEditorStore } from '@/store/store'
import { Step } from '@/types'

// A step mark records the timestamp at which a new step begins
interface StepMark {
  id: string
  title: string
  startTime: number  // seconds from recording start
}

const MIN_STEP_GAP = 1  // seconds — debounce rapid clicks

function getVideoMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.onerror = reject
    v.src = url
  })
}

function formatTime(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function RecordPage() {
  const router = useRouter()
  const recorderRef = useRef<ScreenRecorder | null>(null)
  const createProject = useEditorStore(s => s.createProject)

  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Use refs to avoid stale closures in event handlers
  const elapsedRef = useRef(0)
  const stepMarksRef = useRef<StepMark[]>([])
  const lastMarkTimeRef = useRef(-Infinity)

  const [supported, setSupported] = useState(true)
  const [walkthroughName, setWalkthroughName] = useState('')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [stepMarks, setStepMarks] = useState<StepMark[]>([])
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState('')

  useEffect(() => {
    setSupported(ScreenRecorder.isSupported())
  }, [])

  // Keep ref in sync
  useEffect(() => {
    stepMarksRef.current = stepMarks
  }, [stepMarks])

  // ── Step marking ─────────────────────────────────────────────────────────

  const markStep = useCallback(() => {
    const t = elapsedRef.current
    if (t - lastMarkTimeRef.current < MIN_STEP_GAP) return
    if (stepMarksRef.current.length >= 19) return  // step 1 is implicit, cap total at 20
    lastMarkTimeRef.current = t
    const id = crypto.randomUUID()
    setStepMarks(prev => {
      const num = prev.length + 2  // step 1 is implicit; this starts step 2, 3, …
      const mark: StepMark = { id, title: `Step ${num}`, startTime: t }
      stepMarksRef.current = [...prev, mark]
      return stepMarksRef.current
    })
  }, [])

  // Auto-mark on browser navigation (pushState / popstate)
  const onNavigation = useCallback(() => { markStep() }, [markStep])

  useEffect(() => {
    if (!recording) return

    window.addEventListener('popstate', onNavigation)

    // Patch history.pushState so SPA navigation is also caught
    const origPush = history.pushState.bind(history)
    history.pushState = (...args) => { origPush(...args); onNavigation() }

    return () => {
      window.removeEventListener('popstate', onNavigation)
      history.pushState = origPush
    }
  }, [recording, onNavigation])

  // Space key → manual step mark while recording
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        markStep()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, markStep])

  // ── Recording lifecycle ───────────────────────────────────────────────────

  async function stopRecording() {
    if (!recorderRef.current) return
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    setRecording(false)
    const blob = await recorderRef.current.stop()
    recorderRef.current = null
    setRecordedBlob(blob)
  }

  async function startRecording() {
    try {
      const rec = new ScreenRecorder()

      // Reset state before starting so UI is clean
      elapsedRef.current = 0
      lastMarkTimeRef.current = -Infinity
      stepMarksRef.current = []
      setStepMarks([])
      setRecordedBlob(null)
      setElapsed(0)

      await rec.start(() => {
        // Browser "Stop sharing" button was clicked — mirror it in the UI
        stopRecording()
      })

      // Only assign after start() succeeds — prevents stopRecording() from
      // seeing a half-initialised recorder during the getDisplayMedia() prompt
      recorderRef.current = rec
      setRecording(true)
      elapsedIntervalRef.current = setInterval(() => {
        elapsedRef.current += 1
        setElapsed(e => e + 1)
      }, 1000)
    } catch {
      recorderRef.current = null
    }
  }

  function updateTitle(id: string, title: string) {
    setStepMarks(prev => prev.map(m => m.id === id ? { ...m, title } : m))
  }

  function deleteStepMark(id: string) {
    setStepMarks(prev => prev.filter(m => m.id !== id))
  }

  // ── Upload & project creation ─────────────────────────────────────────────

  async function handleDone() {
    if (!recordedBlob) return
    const name = walkthroughName.trim() || 'Untitled Walkthrough'
    setUploading(true)

    try {
      // Read video metadata
      const objectUrl = URL.createObjectURL(recordedBlob)
      const { duration: totalDuration, width, height } = await getVideoMetadata(objectUrl)
      URL.revokeObjectURL(objectUrl)

      // Upload single recording to S3
      setUploadLabel('Uploading recording…')
      const sourceId = crypto.randomUUID()
      const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm'
      const urlRes = await fetch('/api/sources/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, fileName: `recording.${ext}`, contentType: recordedBlob.type || 'video/webm' }),
      })
      if (!urlRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = await urlRes.json()

      const localObjectUrl = URL.createObjectURL(recordedBlob)
      const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: recordedBlob, headers: { 'Content-Type': recordedBlob.type || 'video/webm' } })
      if (!uploadRes.ok) throw new Error('S3 upload failed')

      setUploadLabel('Creating project…')

      // Build clips from time boundaries
      // boundaries = [0, mark1.startTime, mark2.startTime, …, totalDuration]
      const boundaries = [0, ...stepMarks.slice(0, 19).map(m => m.startTime), totalDuration]
      const stepTitles = ['Step 1', ...stepMarks.map(m => m.title)]

      const clips = boundaries.slice(0, -1).map((start, i) => ({
        id: crypto.randomUUID(),
        sourceId,
        name: stepTitles[i] ?? `Step ${i + 1}`,
        trimStart: start,
        trimEnd: boundaries[i + 1],
      }))

      const projectSteps: Step[] = clips.map((clip, i) => ({
        id: crypto.randomUUID(),
        clipId: clip.id,
        sourceId,
        title: clip.name,
        description: '',
        timelinePosition: boundaries[i],
      }))

      const source = { id: sourceId, name, duration: totalDuration, width, height, s3Key, objectUrl: localObjectUrl }

      const metadata = {
        clips,
        sources: [{ ...source, objectUrl: '' }],
        audioLayers: [],
        overlayLayers: [],
        steps: projectSteps,
      }

      const projectId = crypto.randomUUID()
      const now = Date.now()

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name,
          metadata,
          sources: [{ id: sourceId, name, duration: totalDuration, s3Key }],
        }),
      })
      if (!res.ok) throw new Error('Failed to create project')

      // Hydrate local store so the editor opens instantly
      const storeProjectId = createProject(name, { id: sourceId, name, duration: totalDuration, width, height, objectUrl: localObjectUrl, s3Key })
      const { hydrateProject, setActiveProject, deleteProject } = useEditorStore.getState()
      hydrateProject({ id: projectId, name, createdAt: now, clips, sources: [source], audioLayers: [], overlayLayers: [], steps: projectSteps })
      setActiveProject(projectId)
      deleteProject(storeProjectId)

      router.push(`/editor/${projectId}`)
    } catch (err) {
      console.error('Failed to create walkthrough:', err)
      setUploading(false)
      setUploadLabel('')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // All steps for display: the implicit first step + all marks
  const allSteps = [
    { id: '__step1__', title: 'Step 1', startTime: 0, isFirst: true },
    ...stepMarks.map(m => ({ ...m, isFirst: false })),
  ]

  if (!supported) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-neutral-200 font-medium mb-2">Screen recording not supported</p>
          <p className="text-neutral-500 text-sm">Please use Chrome, Edge, or Firefox on desktop.</p>
          <button onClick={() => router.push('/')} className="mt-6 text-sm text-blue-400 hover:text-blue-300">← Back</button>
        </div>
      </div>
    )
  }

  if (uploading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-300 text-sm">{uploadLabel}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center gap-4 shrink-0">
        <button onClick={() => router.push('/')} className="text-neutral-400 hover:text-white text-sm transition-colors">
          ← Back
        </button>
        <span className="w-px h-4 bg-neutral-700" />
        <input
          type="text"
          value={walkthroughName}
          onChange={e => setWalkthroughName(e.target.value)}
          placeholder="Walkthrough name…"
          className="bg-transparent text-white text-sm font-medium placeholder:text-neutral-600 focus:outline-none w-64"
        />
        {recordedBlob && (
          <button
            onClick={handleDone}
            className="ml-auto bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            Done — Open in Editor
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Steps sidebar */}
        <aside className="w-72 border-r border-neutral-800 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-neutral-800">
            <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">
              {allSteps.length} step{allSteps.length !== 1 ? 's' : ''}
              {recording && <span className="ml-2 text-neutral-600 normal-case tracking-normal font-normal">auto-detecting…</span>}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {allSteps.map((step, i) => (
              <div key={step.id} className="border-b border-neutral-800/50 px-4 py-3 group">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-neutral-600 font-mono mt-0.5 shrink-0 w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    {!step.isFirst && editingStepId === step.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={step.title}
                        onChange={e => updateTitle(step.id, e.target.value)}
                        onBlur={() => setEditingStepId(null)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingStepId(null) }}
                        className="w-full bg-neutral-800 border border-neutral-600 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    ) : (
                      <p
                        onClick={() => !step.isFirst && setEditingStepId(step.id)}
                        className={`text-sm text-neutral-200 truncate ${!step.isFirst ? 'cursor-text hover:text-white' : ''}`}
                      >
                        {step.title}
                      </p>
                    )}
                    <p className="text-xs text-neutral-600 mt-0.5">@ {formatTime(step.startTime)}</p>
                  </div>
                  {!step.isFirst && (
                    <button
                      onClick={() => deleteStepMark(step.id)}
                      className="text-neutral-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Recording controls */}
        <main className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
          {recording ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 text-sm font-medium">Recording</span>
                <span className="text-neutral-500 text-sm tabular-nums ml-1">{formatTime(elapsed)}</span>
                <span className="ml-3 text-neutral-600 text-sm">{allSteps.length} step{allSteps.length !== 1 ? 's' : ''}</span>
              </div>
              <p className="text-neutral-500 text-sm text-center max-w-sm">
                Press <kbd className="mx-1 px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-xs font-mono">Space</kbd> or click <strong className="text-neutral-400 font-medium">+ Mark Step</strong> to start a new step.
                Page navigations are detected automatically.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={markStep}
                  className="px-5 py-2.5 rounded-xl border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white text-sm font-medium transition-colors"
                >
                  + Mark Step
                </button>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
                >
                  <span className="w-3 h-3 rounded-sm bg-white" />
                  Stop Recording
                </button>
              </div>
            </>
          ) : recordedBlob ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-green-950 flex items-center justify-center">
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-neutral-200 font-medium mb-1">Recording complete</p>
                <p className="text-neutral-500 text-sm">
                  {allSteps.length} step{allSteps.length !== 1 ? 's' : ''} detected.
                  Rename them in the sidebar, then open in the editor.
                </p>
              </div>
              <button
                onClick={handleDone}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              >
                Open in Editor
              </button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-neutral-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-neutral-200 font-medium mb-1">Record your walkthrough</p>
                <p className="text-neutral-500 text-sm max-w-xs">
                  One continuous recording. Every click or page navigation is automatically detected as a new step.
                </p>
              </div>
              <button
                onClick={startRecording}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-white" />
                Start Recording
              </button>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
