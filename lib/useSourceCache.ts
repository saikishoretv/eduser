'use client'

import { useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { Project } from '@/types'

async function resolveSourceUrl(s3Key: string): Promise<string | null> {
  try {
    const res = await fetch('/api/sources/download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3Key }),
    })
    if (!res.ok) return null
    const { downloadUrl } = await res.json()
    return downloadUrl
  } catch {
    return null
  }
}

export function useSourceCache(project: Project | undefined) {
  const setSourceObjectUrl = useEditorStore(s => s.setSourceObjectUrl)

  useEffect(() => {
    if (!project) return

    for (const source of project.sources) {
      if (!source.objectUrl && source.s3Key) {
        resolveSourceUrl(source.s3Key).then(url => {
          if (url) setSourceObjectUrl(source.id, url)
        })
      }
    }
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
