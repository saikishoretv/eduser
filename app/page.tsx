'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/store'
import { SourceVideo } from '@/types'
import { signOut, useSession } from '@/lib/auth-client'

const TIPS = [
  'Trim clips by dragging their edges in the timeline.',
  'Press F to insert a freeze frame at the current playhead position.',
  'Add background music or voiceover using the audio track in the timeline.',
  'Use Ken Burns or Punch zoom presets to add motion to static clips.',
  'Generate automatic subtitles by clicking Transcribe in the toolbar.',
  'Export in different aspect ratios — perfect for social media.',
  'Use color correction to fine-tune brightness, contrast, and saturation.',
  'Add text or image overlays to annotate your video.',
  'Drag clips in the timeline to reorder them at any time.',
  'Use the speed control to create slow-motion or time-lapse effects.',
]

function UploadModal({ stage, progress }: { stage: string; progress: number }) {
  const [tipIdx, setTipIdx] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setTipIdx(i => (i + 1) % TIPS.length)
        setFade(true)
      }, 400)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 w-full max-w-sm mx-4 flex flex-col items-center gap-6">
        {/* Spinner + stage */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-neutral-700 border-t-blue-500 animate-spin" />
          <p className="text-neutral-300 text-sm font-medium">{stage}</p>
        </div>

        {/* Progress bar */}
        <div className="w-full">
          <div className="flex justify-between text-xs text-neutral-500 mb-1.5">
            <span>Uploading</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Rotating tip */}
        <div className="w-full rounded-xl bg-neutral-800/60 px-4 py-3 min-h-[64px] flex items-center">
          <p
            className="text-xs text-neutral-400 leading-relaxed transition-opacity duration-400"
            style={{ opacity: fade ? 1 : 0 }}
          >
            <span className="text-neutral-500 font-medium mr-1">Tip:</span>
            {TIPS[tipIdx]}
          </p>
        </div>
      </div>
    </div>
  )
}

async function uploadWithProgress(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  // Simulate progress while fetch uploads (fetch has no native progress API)
  let simulated = 0
  const interval = setInterval(() => {
    simulated = Math.min(simulated + Math.random() * 8 + 2, 90)
    onProgress(Math.round(simulated))
  }, 400)
  try {
    const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    onProgress(100)
  } finally {
    clearInterval(interval)
  }
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getVideoMetadata(url: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve({
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      hasAudio: (v.audioTracks?.length ?? 0) > 0,
    })
    v.onerror = reject
    v.src = url
  })
}

export default function ListingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('Loading…')
  const [uploadProgress, setUploadProgress] = useState(0)
  const { data: session } = useSession()
  const user = session?.user ?? null
  const [dbProjects, setDbProjects] = useState<Array<{ id: string; name: string; createdAt: number; duration: number }>>([])
  const [dbLoaded, setDbLoaded] = useState(false)

  const createProject = useEditorStore(s => s.createProject)
  const deleteProject = useEditorStore(s => s.deleteProject)
  const storeProjects = useEditorStore(s => s.projects)

  // Load project list from DB — shows projects from other devices not yet in local store
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.projects) setDbProjects(data.projects) })
      .catch(() => {})
      .finally(() => setDbLoaded(true))
  }, [])

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  function handleDeleteProject(e: React.MouseEvent, projectId: string) {
    e.stopPropagation()
    setDbProjects(prev => prev.filter(p => p.id !== projectId))
    deleteProject(projectId) // clean up in-memory store + IndexedDB blobs
    fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => {})
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setLoadingLabel('Preparing…')
    setUploadProgress(0)
    try {
      const objectUrl = URL.createObjectURL(file)
      const { duration, width, height, hasAudio } = await getVideoMetadata(objectUrl)
      const sourceId = crypto.randomUUID()

      setLoadingLabel('Uploading…')
      const urlRes = await fetch('/api/sources/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, fileName: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = await urlRes.json()

      await uploadWithProgress(uploadUrl, file, file.type, setUploadProgress)

      const source: SourceVideo = {
        id: sourceId,
        name: file.name.replace(/\.[^.]+$/, ''),
        duration,
        width,
        height,
        hasAudio,
        objectUrl,
        s3Key,
      }
      const projectId = createProject(source.name, source)

      const state = useEditorStore.getState()
      const newProject = state.projects.find(p => p.id === projectId)!
      const metadata = {
        clips: newProject.clips,
        sources: newProject.sources.map(s => ({ ...s, objectUrl: '' })),
        audioLayers: [],
        overlayLayers: [],
        steps: newProject.steps,
      }
      fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: newProject.name,
          metadata,
          sources: [{ id: source.id, name: source.name, duration: source.duration, s3Key: source.s3Key! }],
        }),
      }).catch(console.error)

      setDbProjects(prev => [{
        id: projectId,
        name: newProject.name,
        createdAt: newProject.createdAt,
        duration: source.duration,
      }, ...prev])

      router.push(`/editor/${projectId}`)
    } catch (err) {
      console.error('Failed to create project:', err)
      setLoading(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      {loading && <UploadModal stage={loadingLabel} progress={uploadProgress} />}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <span className="text-white font-semibold tracking-tight">Eduser</span>
        <div className="flex items-center gap-3">
          {user && (
            <>
              <span className="text-xs text-neutral-500 hidden sm:block">{user.email}</span>
              <button
                onClick={handleSignOut}
                className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                Sign out
              </button>
              <span className="w-px h-4 bg-neutral-700" />
            </>
          )}
          <button
            onClick={() => router.push('/record')}
            disabled={loading}
            className="border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 text-neutral-300 hover:text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Walkthrough
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Upload Video
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleUpload}
          className="hidden"
        />
      </header>

      <main className="px-6 py-8">
        {!dbLoaded ? null : dbProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-14 h-14 rounded-2xl bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <h2 className="text-neutral-200 font-medium mb-1">No projects yet</h2>
            <p className="text-neutral-500 text-sm mb-6">Upload a video to get started</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              Upload Video
            </button>
          </div>
        ) : (
          <div>
            <p className="text-neutral-500 text-xs font-medium mb-4 uppercase tracking-wider">Projects</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {dbProjects.map(project => (
                <div
                  key={project.id}
                  onClick={() => router.push(`/editor/${project.id}`)}
                  className="bg-neutral-900 rounded-xl border border-neutral-800 hover:border-neutral-600 overflow-hidden cursor-pointer group transition-colors"
                >
                  <div className="aspect-video bg-neutral-800 flex items-center justify-center">
                    <svg className="w-7 h-7 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-neutral-100 truncate">{storeProjects.find(p => p.id === project.id)?.name ?? project.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-neutral-500">{formatDuration(project.duration)}</span>
                      <button
                        onClick={e => handleDeleteProject(e, project.id)}
                        className="text-xs text-neutral-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
