'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/store'
import { SourceVideo } from '@/types'
import { getSupabase } from '@/lib/supabase'
import { saveBlob } from '@/lib/db'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'

function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v.duration)
    v.onerror = reject
    v.src = url
  })
}

export default function ListingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('Loading…')
  const [user, setUser] = useState<User | null>(null)
  const [dbProjects, setDbProjects] = useState<Array<{ id: string; name: string; createdAt: number }>>([])
  const [dbLoaded, setDbLoaded] = useState(false)

  const projects = useEditorStore(s => s.projects)
  const createProject = useEditorStore(s => s.createProject)
  const deleteProject = useEditorStore(s => s.deleteProject)

  useEffect(() => {
    getSupabase().auth.getSession().then((res: { data: { session: Session | null } }) => setUser(res.data.session?.user ?? null))
    const { data: { subscription } } = getSupabase().auth.onAuthStateChange((_: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load project list from DB — shows projects from other devices not yet in local store
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.projects) setDbProjects(data.projects) })
      .catch(() => {})
      .finally(() => setDbLoaded(true))
  }, [])

  async function handleSignOut() {
    await getSupabase().auth.signOut()
    router.push('/login')
  }

  function handleDeleteProject(e: React.MouseEvent, projectId: string) {
    e.stopPropagation()

    // Remove from store and DB list immediately (optimistic)
    deleteProject(projectId)
    setDbProjects(prev => prev.filter(p => p.id !== projectId))

    // Fire-and-forget: DB delete + S3 cleanup handled server-side
    fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => {})
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setLoadingLabel('Loading…')
    try {
      const objectUrl = URL.createObjectURL(file)
      const duration = await getVideoDuration(objectUrl)
      const sourceId = crypto.randomUUID()

      // Get a presigned S3 URL and upload the file
      setLoadingLabel('Uploading…')
      const urlRes = await fetch('/api/sources/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, fileName: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = await urlRes.json()

      const [uploadRes] = await Promise.all([
        fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } }),
        saveBlob(sourceId, file),  // cache locally so reloads don't need S3
      ])
      if (!uploadRes.ok) throw new Error('S3 upload failed')

      const source: SourceVideo = {
        id: sourceId,
        name: file.name.replace(/\.[^.]+$/, ''),
        duration,
        objectUrl,
        s3Key,
      }
      const projectId = createProject(source.name, source)

      // Persist to DB (fire-and-forget — local store is the source of truth until T11)
      const state = useEditorStore.getState()
      const newProject = state.projects.find(p => p.id === projectId)
      if (newProject) {
        const metadata = {
          clips: newProject.clips,
          sources: newProject.sources.map(s => ({ ...s, objectUrl: '' })),
          audioLayers: newProject.audioLayers ?? [],
          overlayLayers: newProject.overlayLayers ?? [],
        }
        fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            name: newProject.name,
            metadata,
            sources: newProject.sources
              .filter(s => s.s3Key)
              .map(s => ({ id: s.id, name: s.name, duration: s.duration, s3Key: s.s3Key! })),
          }),
        }).catch(console.error)
      }

      router.push(`/editor/${projectId}`)
    } catch (err) {
      console.error('Failed to create project:', err)
      setLoading(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <span className="text-white font-semibold tracking-tight">Clipr</span>
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
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? loadingLabel : '+ New Project'}
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
        {(() => {
          const localIds = new Set(projects.map(p => p.id))
          const dbOnlyProjects = dbProjects.filter(p => !localIds.has(p.id))
          const totalCount = projects.length + dbOnlyProjects.length

          if (!dbLoaded && totalCount === 0) return null

          if (totalCount === 0) return (
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
          )

          const videoIcon = (
            <svg className="w-7 h-7 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )

          return (
            <div>
              <p className="text-neutral-500 text-xs font-medium mb-4 uppercase tracking-wider">Projects</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {/* Local projects — full data available */}
                {projects.map(project => {
                  const duration = project.clips.reduce((s, c) => s + (c.trimEnd - c.trimStart), 0)
                  return (
                    <div
                      key={project.id}
                      onClick={() => router.push(`/editor/${project.id}`)}
                      className="bg-neutral-900 rounded-xl border border-neutral-800 hover:border-neutral-600 overflow-hidden cursor-pointer group transition-colors"
                    >
                      <div className="aspect-video bg-neutral-800 flex items-center justify-center">{videoIcon}</div>
                      <div className="p-3">
                        <p className="text-sm font-medium text-neutral-100 truncate">{project.name}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-neutral-500">{formatDuration(duration)}</span>
                          <button
                            onClick={e => handleDeleteProject(e, project.id)}
                            className="text-xs text-neutral-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* DB-only projects — not yet loaded locally (T10 will hydrate on open) */}
                {dbOnlyProjects.map(project => (
                  <div
                    key={project.id}
                    onClick={() => router.push(`/editor/${project.id}`)}
                    className="bg-neutral-900 rounded-xl border border-neutral-800 hover:border-neutral-600 overflow-hidden cursor-pointer group transition-colors"
                  >
                    <div className="aspect-video bg-neutral-800 flex items-center justify-center">{videoIcon}</div>
                    <div className="p-3">
                      <p className="text-sm font-medium text-neutral-100 truncate">{project.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-neutral-500">—</span>
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
          )
        })()}
      </main>
    </div>
  )
}
