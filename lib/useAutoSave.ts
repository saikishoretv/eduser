'use client'

import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/store'

type StoreState = ReturnType<typeof useEditorStore.getState>

const DEBOUNCE_MS = 2000

// Build the metadata object to persist — mirrors the partialize shape but
// scoped to a single project and filtered per-clip keys to that project only.
function buildMetadata(s: StoreState, projectId: string): Record<string, unknown> | null {
  const project = s.projects.find(p => p.id === projectId)
  if (!project) return null

  const clipIds = new Set(project.clips.map(c => c.id))
  const pick = <T>(map: Record<string, T>) =>
    Object.fromEntries(Object.entries(map).filter(([k]) => clipIds.has(k)))

  return {
    clips: project.clips,
    sources: project.sources.map(src => ({ ...src, objectUrl: '' })),
    audioLayers: (project.audioLayers ?? []).map(al => ({ ...al, objectUrl: '' })),
    overlayLayers: (project.overlayLayers ?? []).map(ol =>
      ol.type === 'image' ? { ...ol, objectUrl: '' } : ol
    ),
    steps: project.steps,
    clipCrops:               pick(s.clipCrops),
    clipZooms:               pick(s.clipZooms),
    clipZoomPresets:         pick(s.clipZoomPresets),
    clipTransitionDurations: pick(s.clipTransitionDurations),
    clipTransitionIn:        pick(s.clipTransitionIn),
    clipTransitionOut:       pick(s.clipTransitionOut),
    clipColorCorrections:    pick(s.clipColorCorrections),
    subtitleStyle:              s.subtitleStyle,
    subtitleAppearance:         s.subtitleAppearance,
    standardSubtitleAppearance: s.standardSubtitleAppearance,
    outputFormat:               s.outputFormat,
  }
}

export function useAutoSave(projectId: string | null) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaveRef = useRef<string>('')

  useEffect(() => {
    if (!projectId) return

    const unsubscribe = useEditorStore.subscribe((state) => {
      const metadata = buildMetadata(state, projectId)
      if (!metadata) return

      // Skip ephemeral-only changes (playhead, selection, playback)
      const snapshot = JSON.stringify(metadata)
      if (snapshot === lastSaveRef.current) return

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        lastSaveRef.current = snapshot
        const project = state.projects.find(p => p.id === projectId)
        fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata, name: project?.name }),
        }).catch(console.error)
      }, DEBOUNCE_MS)
    })

    return () => {
      unsubscribe()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [projectId])
}
