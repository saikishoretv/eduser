'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ScreenRecorder } from '@/lib/recorder'
import { saveBlob } from '@/lib/db'
import { useEditorStore } from '@/store/store'
import { Step } from '@/types'

interface RecordedStep {
  id: string
  title: string
  blob: Blob
  duration: number
  width: number
  height: number
  objectUrl: string   // temporary preview URL
}

function getVideoMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.onerror = reject
    v.src = url
  })
}

function formatDuration(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function RecordPage() {
  const router = useRouter()
  const recorderRef = useRef<ScreenRecorder | null>(null)
  const createProject = useEditorStore(s => s.createProject)

  const [supported, setSupported] = useState(true)
  const [walkthroughName, setWalkthroughName] = useState('')
  const [steps, setSteps] = useState<RecordedStep[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState('')
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSupported(ScreenRecorder.isSupported())
  }, [])

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      steps.forEach(s => URL.revokeObjectURL(s.objectUrl))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function startRecording() {
    try {
      const rec = new ScreenRecorder()
      recorderRef.current = rec
      await rec.start()
      setRecording(true)
      setElapsed(0)
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } catch {
      // User cancelled screen share dialog — no-op
      recorderRef.current = null
    }
  }

  async function stopRecording() {
    if (!recorderRef.current) return
    if (elapsedRef.current) clearInterval(elapsedRef.current)
    setRecording(false)

    const blob = await recorderRef.current.stop()
    recorderRef.current = null

    const objectUrl = URL.createObjectURL(blob)
    const meta = await getVideoMetadata(objectUrl)

    const id = crypto.randomUUID()
    const step: RecordedStep = {
      id,
      title: `Step ${steps.length + 1}`,
      blob,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      objectUrl,
    }

    setSteps(prev => [...prev, step])
    setEditingStepId(id)  // auto-focus title edit for this step
  }

  function updateTitle(id: string, title: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, title } : s))
  }

  function deleteStep(id: string) {
    setSteps(prev => {
      const step = prev.find(s => s.id === id)
      if (step) URL.revokeObjectURL(step.objectUrl)
      return prev.filter(s => s.id !== id)
    })
  }

  async function handleDone() {
    if (steps.length === 0) return
    const name = walkthroughName.trim() || 'Untitled Walkthrough'
    setUploading(true)

    try {
      const uploadedSources: Array<{
        id: string; name: string; duration: number
        width: number; height: number; s3Key: string; objectUrl: string
      }> = []

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        setUploadLabel(`Uploading step ${i + 1} of ${steps.length}…`)

        const sourceId = crypto.randomUUID()
        const ext = step.blob.type.includes('mp4') ? 'mp4' : 'webm'
        const fileName = `step-${i + 1}.${ext}`

        // Get presigned upload URL
        const urlRes = await fetch('/api/sources/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, fileName, contentType: step.blob.type || 'video/webm' }),
        })
        if (!urlRes.ok) throw new Error('Failed to get upload URL')
        const { uploadUrl, s3Key } = await urlRes.json()

        // Upload to S3 + cache locally in parallel
        const [uploadRes] = await Promise.all([
          fetch(uploadUrl, { method: 'PUT', body: step.blob, headers: { 'Content-Type': step.blob.type || 'video/webm' } }),
          saveBlob(sourceId, step.blob),
        ])
        if (!uploadRes.ok) throw new Error(`S3 upload failed for step ${i + 1}`)

        uploadedSources.push({
          id: sourceId,
          name: step.title,
          duration: step.duration,
          width: step.width,
          height: step.height,
          s3Key,
          objectUrl: step.objectUrl,
        })
      }

      setUploadLabel('Creating project…')

      // Build clips, sources, and steps for the project
      const projectId = crypto.randomUUID()
      const now = Date.now()

      const clips = uploadedSources.map(src => ({
        id: crypto.randomUUID(),
        sourceId: src.id,
        name: src.name,
        trimStart: 0,
        trimEnd: src.duration,
      }))

      const projectSteps: Step[] = clips.map((clip, i) => ({
        id: crypto.randomUUID(),
        clipId: clip.id,
        sourceId: uploadedSources[i].id,
        title: steps[i].title,
        description: '',
      }))

      const metadata = {
        clips,
        sources: uploadedSources.map(s => ({ ...s, objectUrl: '' })),
        audioLayers: [],
        overlayLayers: [],
        steps: projectSteps,
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name,
          metadata,
          sources: uploadedSources.map(s => ({
            id: s.id, name: s.name, duration: s.duration, s3Key: s.s3Key,
          })),
        }),
      })
      if (!res.ok) throw new Error('Failed to create project')

      // Hydrate into local store so editor opens instantly
      const firstSource = uploadedSources[0]
      const storeProjectId = createProject(name, {
        id: firstSource.id,
        name: firstSource.name,
        duration: firstSource.duration,
        width: firstSource.width,
        height: firstSource.height,
        objectUrl: firstSource.objectUrl,
        s3Key: firstSource.s3Key,
      })

      // Replace store project with full project data
      const { hydrateProject, setActiveProject } = useEditorStore.getState()
      hydrateProject({
        id: projectId,
        name,
        createdAt: now,
        clips,
        sources: uploadedSources,
        audioLayers: [],
        overlayLayers: [],
        steps: projectSteps,
      })
      setActiveProject(projectId)

      // Clean up the temp project createProject made
      useEditorStore.getState().deleteProject(storeProjectId)

      router.push(`/editor/${projectId}`)
    } catch (err) {
      console.error('Failed to create walkthrough:', err)
      setUploading(false)
      setUploadLabel('')
    }
  }

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
        {steps.length > 0 && !recording && (
          <button
            onClick={handleDone}
            className="ml-auto bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            Done — Open in Editor
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Steps list */}
        <aside className="w-72 border-r border-neutral-800 flex flex-col overflow-y-auto shrink-0">
          <div className="px-4 py-3 border-b border-neutral-800">
            <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">
              {steps.length === 0 ? 'No steps yet' : `${steps.length} step${steps.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {steps.map((step, i) => (
              <div key={step.id} className="border-b border-neutral-800/50 px-4 py-3 group">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-neutral-600 font-mono mt-0.5 shrink-0 w-5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    {editingStepId === step.id ? (
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
                        onClick={() => setEditingStepId(step.id)}
                        className="text-sm text-neutral-200 truncate cursor-text hover:text-white"
                      >
                        {step.title}
                      </p>
                    )}
                    <p className="text-xs text-neutral-600 mt-0.5">{formatDuration(step.duration)}</p>
                  </div>
                  <button
                    onClick={() => deleteStep(step.id)}
                    className="text-neutral-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main recording area */}
        <main className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
          {recording ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 text-sm font-medium">Recording…</span>
                <span className="text-neutral-500 text-sm tabular-nums ml-1">{formatDuration(elapsed)}</span>
              </div>
              <p className="text-neutral-500 text-sm text-center max-w-xs">
                Demonstrate step {steps.length + 1} on your screen, then click Stop when done.
              </p>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                <span className="w-3 h-3 rounded-sm bg-white" />
                Stop Recording
              </button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-neutral-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-neutral-200 font-medium mb-1">
                  {steps.length === 0 ? 'Record your first step' : `Record step ${steps.length + 1}`}
                </p>
                <p className="text-neutral-500 text-sm max-w-xs">
                  {steps.length === 0
                    ? 'Click below to start capturing your screen. Each step becomes a separate clip in the editor.'
                    : 'Continue recording the next step of your walkthrough, or click Done to open in the editor.'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={startRecording}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                >
                  <span className="w-3 h-3 rounded-full bg-white" />
                  {steps.length === 0 ? 'Start Recording' : 'Record Next Step'}
                </button>
                {steps.length > 0 && (
                  <button
                    onClick={handleDone}
                    className="px-6 py-3 rounded-xl border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 font-medium transition-colors"
                  >
                    Done — Open in Editor
                  </button>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
