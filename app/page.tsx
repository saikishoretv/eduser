'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorStore } from '@/store/store'
import { SourceVideo } from '@/types'

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

  const projects = useEditorStore(s => s.projects)
  const createProject = useEditorStore(s => s.createProject)
  const deleteProject = useEditorStore(s => s.deleteProject)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const objectUrl = URL.createObjectURL(file)
      const duration = await getVideoDuration(objectUrl)
      const source: SourceVideo = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        duration,
        objectUrl,
      }
      const id = createProject(source.name, source)
      router.push(`/editor/${id}`)
    } catch (err) {
      console.error('Failed to load video:', err)
      setLoading(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <span className="text-white font-semibold tracking-tight">Clipr</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Loading…' : '+ New Project'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleUpload}
          className="hidden"
        />
      </header>

      <main className="px-6 py-8">
        {projects.length === 0 ? (
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
              {projects.map(project => {
                const duration = project.clips.reduce((s, c) => s + (c.trimEnd - c.trimStart), 0)
                return (
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
                      <p className="text-sm font-medium text-neutral-100 truncate">{project.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-neutral-500">{formatDuration(duration)}</span>
                        <button
                          onClick={e => { e.stopPropagation(); deleteProject(project.id) }}
                          className="text-xs text-neutral-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
