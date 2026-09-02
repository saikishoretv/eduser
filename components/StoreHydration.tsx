'use client'

import { useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { loadBlob } from '@/lib/db'

export default function StoreHydration() {
  useEffect(() => {
    async function run() {
      // Load persisted metadata from localStorage
      await useEditorStore.persist.rehydrate()

      // Rebuild blob URLs from IndexedDB for every source and audio layer that has no objectUrl
      const { projects } = useEditorStore.getState()
      for (const project of projects) {
        for (const source of project.sources) {
          if (source.objectUrl) continue
          const blob = await loadBlob(source.id)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          useEditorStore.setState(s => ({
            projects: s.projects.map(p =>
              p.id !== project.id ? p : {
                ...p,
                sources: p.sources.map(src =>
                  src.id === source.id ? { ...src, objectUrl: url } : src
                ),
              }
            ),
          }))
        }
        for (const ol of project.overlayLayers ?? []) {
          if (ol.type !== 'image' || ol.objectUrl) continue
          const blob = await loadBlob(ol.blobId ?? ol.id)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          useEditorStore.setState(s => ({
            projects: s.projects.map(p =>
              p.id !== project.id ? p : {
                ...p,
                overlayLayers: (p.overlayLayers ?? []).map(o =>
                  o.id === ol.id ? { ...o, objectUrl: url } : o
                ),
              }
            ),
          }))
        }
        for (const layer of project.audioLayers ?? []) {
          if (layer.objectUrl) continue
          const blob = await loadBlob(layer.blobId ?? layer.id)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          useEditorStore.setState(s => ({
            projects: s.projects.map(p =>
              p.id !== project.id ? p : {
                ...p,
                audioLayers: (p.audioLayers ?? []).map(al =>
                  al.id === layer.id ? { ...al, objectUrl: url } : al
                ),
              }
            ),
          }))
        }
      }
    }
    run()
  }, [])

  return null
}
