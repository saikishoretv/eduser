'use client'

import { useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { loadBlob, saveBlob } from '@/lib/db'
import { Project } from '@/types'

// Resolves a dead or missing objectUrl for a source:
//   1. IndexedDB (populated at upload time and after first S3 download)
//   2. Presigned S3 download (saves back to IndexedDB for next time)
// Returns a fresh blob URL or null if the source cannot be resolved.
async function resolveSourceUrl(sourceId: string, s3Key: string | undefined): Promise<string | null> {
  // Try IndexedDB first — fastest, no network
  const cached = await loadBlob(sourceId)
  if (cached) {
    return URL.createObjectURL(cached)
  }

  // Fall back to S3
  if (!s3Key) return null

  try {
    const res = await fetch('/api/sources/download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3Key }),
    })
    if (!res.ok) return null

    const { downloadUrl } = await res.json()
    const fileRes = await fetch(downloadUrl)
    if (!fileRes.ok) return null

    const blob = await fileRes.blob()
    await saveBlob(sourceId, blob)
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

export function useSourceCache(project: Project | undefined) {
  const setSourceObjectUrl = useEditorStore(s => s.setSourceObjectUrl)

  useEffect(() => {
    if (!project) return

    for (const source of project.sources) {
      resolveSourceUrl(source.id, source.s3Key).then(url => {
        if (url) setSourceObjectUrl(source.id, url)
      })
    }
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
