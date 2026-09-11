import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Clip, Project, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer } from '@/types'
import { getClipTimings, getTotalDuration, canMerge, getSelectedIndices } from '@/lib/clipUtils'
import { FormatPreset } from '@/lib/formats'
import { saveBlob, deleteBlob } from '@/lib/db'
import { SubtitleAppearance, SUBTITLE_DEFAULT, StandardSubtitleAppearance, STANDARD_SUBTITLE_DEFAULT } from '@/lib/subtitleTemplates'
import { ColorCorrection, COLOR_CORRECTION_DEFAULT } from '@/lib/colorPresets'

export type ZoomPreset = 'none' | 'punch' | 'ken-burns'
export type SubtitleStyle = 'off' | 'standard' | 'highlight'
export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-top' | 'slide-bottom' | 'blur'

type UndoSnapshot = {
  projects: Project[]
  clipCrops: Record<string, { x: number; y: number }>
  clipZooms: Record<string, number>
  clipZoomPresets: Record<string, ZoomPreset>
  clipTransitionDurations: Record<string, number>
  clipTransitionIn: Record<string, TransitionType>
  clipTransitionOut: Record<string, TransitionType>
  clipColorCorrections: Record<string, ColorCorrection>
}

interface EditorStore {
  projects: Project[]
  activeProjectId: string | null
  selectedClipIds: string[]
  selectedAudioLayerId: string | null
  selectedOverlayId: string | null
  clipboard: Clip[]
  playheadTime: number
  previewTime: number | null
  isPlaying: boolean
  zoom: number

  outputFormat: FormatPreset | null
  clipCrops: Record<string, { x: number; y: number }>
  clipZooms: Record<string, number>
  clipZoomPresets: Record<string, ZoomPreset>
  clipTransitionDurations: Record<string, number>
  clipTransitionIn: Record<string, TransitionType>
  clipTransitionOut: Record<string, TransitionType>
  clipColorCorrections: Record<string, ColorCorrection>
  subtitleStyle: SubtitleStyle
  subtitleAppearance: SubtitleAppearance
  standardSubtitleAppearance: StandardSubtitleAppearance

  undoPast: UndoSnapshot[]
  undoFuture: UndoSnapshot[]

  createProject: (name: string, source: SourceVideo) => string
  deleteProject: (id: string) => void
  setActiveProject: (id: string) => void
  setSourceTranscript: (sourceId: string, transcript: TranscriptSegment[]) => void

  selectClip: (id: string, addToSelection: boolean) => void
  clearSelection: () => void

  setOutputFormat: (format: FormatPreset | null) => void
  setClipCrop: (clipId: string, x: number, y: number) => void
  setClipZoom: (clipId: string, zoom: number) => void
  setClipZoomPreset: (clipId: string, preset: ZoomPreset) => void
  setClipTransitionDuration: (clipId: string, duration: number) => void
  setClipTransitionIn: (clipId: string, t: TransitionType) => void
  setClipTransitionOut: (clipId: string, t: TransitionType) => void
  setClipColorCorrection: (clipId: string, cc: ColorCorrection) => void
  setAllClipsColorCorrection: (cc: ColorCorrection) => void
  addAudioLayer: (layer: AudioLayer) => void
  removeAudioLayer: (layerId: string) => void
  updateAudioLayer: (layerId: string, patch: Partial<Pick<AudioLayer, 'volume' | 'startAt' | 'trimStart' | 'trimEnd'>>) => void
  setSelectedAudioLayerId: (id: string | null) => void
  updateClip: (clipId: string, patch: Partial<Pick<Clip, 'trimStart' | 'trimEnd'>>) => void
  addOverlayLayer: (layer: OverlayLayer) => void
  removeOverlayLayer: (id: string) => void
  updateOverlayLayer: (id: string, patch: Partial<OverlayLayer>) => void
  setSelectedOverlayId: (id: string | null) => void

  setSubtitleStyle: (style: SubtitleStyle) => void
  setSubtitleAppearance: (appearance: SubtitleAppearance) => void
  setStandardSubtitleAppearance: (appearance: StandardSubtitleAppearance) => void
  setPlayhead: (time: number) => void
  setPreviewTime: (time: number | null) => void
  setPlaying: (playing: boolean) => void
  setZoom: (zoom: number) => void

  audioLayerClipboard: AudioLayer | null
  overlayClipboard: OverlayLayer | null

  cutOverlayLayer: () => void
  copyOverlayLayer: () => void
  pasteOverlayLayer: () => void
  duplicateOverlayLayer: () => void

  detachAudio: (clipId: string) => void
  splitAudioLayer: () => void
  cutAudioLayer: () => void
  copyAudioLayer: () => void
  pasteAudioLayer: () => void
  duplicateAudioLayer: () => void
  split: () => void
  cut: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  merge: () => void
  deleteSelected: () => void

  pushUndo: () => void
  undo: () => void
  redo: () => void
}

function uid(): string {
  return crypto.randomUUID()
}

function activeProject(s: EditorStore): Project | undefined {
  return s.projects.find(p => p.id === s.activeProjectId)
}

function replaceClips(projects: Project[], projectId: string, clips: Clip[]): Project[] {
  return projects.map(p => (p.id === projectId ? { ...p, clips } : p))
}

function captureSnapshot(s: EditorStore): UndoSnapshot {
  return {
    projects: s.projects,
    clipCrops: s.clipCrops,
    clipZooms: s.clipZooms,
    clipZoomPresets: s.clipZoomPresets,
    clipTransitionDurations: s.clipTransitionDurations,
    clipTransitionIn: s.clipTransitionIn,
    clipTransitionOut: s.clipTransitionOut,
    clipColorCorrections: s.clipColorCorrections,
  }
}

function withUndo(s: EditorStore): { undoPast: UndoSnapshot[]; undoFuture: UndoSnapshot[] } {
  return {
    undoPast: [...s.undoPast.slice(-9), captureSnapshot(s)],
    undoFuture: [],
  }
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      selectedClipIds: [],
      selectedAudioLayerId: null,
      selectedOverlayId: null,
      audioLayerClipboard: null,
      overlayClipboard: null,
      clipboard: [],
      playheadTime: 0,
      previewTime: null,
      isPlaying: false,
      zoom: 80,
      outputFormat: null,
      clipCrops: {},
      clipZooms: {},
      clipZoomPresets: {},
      clipTransitionDurations: {},
      clipTransitionIn: {},
      clipTransitionOut: {},
      clipColorCorrections: {},
      subtitleStyle: 'off' as SubtitleStyle,
      subtitleAppearance: SUBTITLE_DEFAULT,
      standardSubtitleAppearance: STANDARD_SUBTITLE_DEFAULT,
      undoPast: [],
      undoFuture: [],

      createProject: (name, source) => {
        const id = uid()
        const clip: Clip = { id: uid(), sourceId: source.id, name: source.name, trimStart: 0, trimEnd: source.duration }
        const project: Project = { id, name, createdAt: Date.now(), clips: [clip], sources: [source], audioLayers: [], overlayLayers: [] }
        set(s => ({ projects: [...s.projects, project] }))
        // Persist blob to IndexedDB (fire-and-forget)
        fetch(source.objectUrl)
          .then(r => r.blob())
          .then(blob => saveBlob(source.id, blob))
          .catch(console.error)
        return id
      },

      deleteProject: (id) => {
        const project = get().projects.find(p => p.id === id)
        if (project) {
          project.sources.forEach(s => deleteBlob(s.id).catch(() => {}))
        }
        set(s => ({
          projects: s.projects.filter(p => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }))
      },

      setActiveProject: (id) => {
        set({ activeProjectId: id, selectedClipIds: [], selectedAudioLayerId: null, selectedOverlayId: null, playheadTime: 0, isPlaying: false })
      },

      setSourceTranscript: (sourceId, transcript) => set(s => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src => src.id === sourceId ? { ...src, transcript } : src),
        })),
      })),

      addAudioLayer: (layer) => set(s => ({
        projects: s.projects.map(p =>
          p.id === s.activeProjectId
            ? { ...p, audioLayers: [...(p.audioLayers ?? []), layer] }
            : p
        ),
        ...withUndo(s),
      })),

      removeAudioLayer: (layerId) => {
        deleteBlob(layerId).catch(() => {})
        set(s => ({
          projects: s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, audioLayers: (p.audioLayers ?? []).filter(al => al.id !== layerId) }
              : p
          ),
          selectedAudioLayerId: s.selectedAudioLayerId === layerId ? null : s.selectedAudioLayerId,
          ...withUndo(s),
        }))
      },

      updateAudioLayer: (layerId, patch) => set(s => ({
        projects: s.projects.map(p =>
          p.id === s.activeProjectId
            ? { ...p, audioLayers: (p.audioLayers ?? []).map(al => al.id === layerId ? { ...al, ...patch } : al) }
            : p
        ),
      })),

      updateClip: (clipId, patch) => set(s => {
        const project = activeProject(s)
        if (!project) return s
        return {
          projects: replaceClips(s.projects, project.id,
            project.clips.map(c => c.id === clipId ? { ...c, ...patch } : c)
          ),
        }
      }),

      setSelectedAudioLayerId: (id) => set({ selectedAudioLayerId: id }),
      addOverlayLayer: (layer) => set(s => ({
        projects: s.projects.map(p =>
          p.id === s.activeProjectId
            ? { ...p, overlayLayers: [...(p.overlayLayers ?? []), layer] }
            : p
        ),
        selectedOverlayId: layer.id,
        ...withUndo(s),
      })),
      removeOverlayLayer: (id) => {
        deleteBlob(id).catch(() => {})
        set(s => ({
          projects: s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, overlayLayers: (p.overlayLayers ?? []).filter(ol => ol.id !== id) }
              : p
          ),
          selectedOverlayId: s.selectedOverlayId === id ? null : s.selectedOverlayId,
          ...withUndo(s),
        }))
      },
      updateOverlayLayer: (id, patch) => set(s => ({
        projects: s.projects.map(p =>
          p.id === s.activeProjectId
            ? { ...p, overlayLayers: (p.overlayLayers ?? []).map(ol => ol.id === id ? { ...ol, ...patch } : ol) }
            : p
        ),
      })),
      setSelectedOverlayId: (id) => set({ selectedOverlayId: id }),

      selectClip: (id, addToSelection) => {
        set(s => ({
          selectedClipIds: addToSelection
            ? s.selectedClipIds.includes(id)
              ? s.selectedClipIds.filter(x => x !== id)
              : [...s.selectedClipIds, id]
            : [id],
        }))
      },

      clearSelection: () => set({ selectedClipIds: [] }),
      setOutputFormat: (format) => set({ outputFormat: format }),
      setClipCrop: (clipId, x, y) => set(s => ({ clipCrops: { ...s.clipCrops, [clipId]: { x, y } } })),
      setClipZoom: (clipId, zoom) => set(s => ({ clipZooms: { ...s.clipZooms, [clipId]: Math.max(1, Math.min(3, zoom)) } })),
      setClipZoomPreset: (clipId, preset) => set(s => ({ clipZoomPresets: { ...s.clipZoomPresets, [clipId]: preset } })),
      setClipTransitionDuration: (clipId, duration) => set(s => ({
        clipTransitionDurations: { ...s.clipTransitionDurations, [clipId]: Math.max(0.1, Math.min(5, duration)) },
        ...withUndo(s),
      })),
      setClipTransitionIn: (clipId, t) => set(s => ({
        clipTransitionIn: { ...s.clipTransitionIn, [clipId]: t },
        ...withUndo(s),
      })),
      setClipTransitionOut: (clipId, t) => set(s => ({
        clipTransitionOut: { ...s.clipTransitionOut, [clipId]: t },
        ...withUndo(s),
      })),
      setClipColorCorrection: (clipId, cc) => set(s => ({
        clipColorCorrections: { ...s.clipColorCorrections, [clipId]: cc },
        ...withUndo(s),
      })),
      setAllClipsColorCorrection: (cc) => set(s => {
        const project = activeProject(s)
        if (!project) return s
        const patch: Record<string, ColorCorrection> = {}
        project.clips.forEach(c => { patch[c.id] = cc })
        return {
          clipColorCorrections: { ...s.clipColorCorrections, ...patch },
          ...withUndo(s),
        }
      }),
      setSubtitleStyle: (style) => set({ subtitleStyle: style }),
      setSubtitleAppearance: (appearance) => set({ subtitleAppearance: appearance }),
      setStandardSubtitleAppearance: (appearance) => set({ standardSubtitleAppearance: appearance }),
      setPlayhead: (time) => set({ playheadTime: Math.max(0, time) }),
      setPreviewTime: (time) => set({ previewTime: time }),
      setPlaying: (playing) => set({ isPlaying: playing }),
      setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(500, zoom)) }),

      splitAudioLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedAudioLayerId) return s
          const layer = (project.audioLayers ?? []).find(l => l.id === s.selectedAudioLayerId)
          if (!layer) return s
          const offset = s.playheadTime - layer.startAt
          const splitSourceTime = layer.trimStart + offset
          if (offset <= 0.01 || splitSourceTime >= layer.trimEnd - 0.01) return s
          const first: AudioLayer  = { ...layer, id: uid(), trimEnd: splitSourceTime,   name: layer.name + ' A' }
          const second: AudioLayer = { ...layer, id: uid(), trimStart: splitSourceTime, startAt: s.playheadTime, name: layer.name + ' B' }
          const audioLayers = (project.audioLayers ?? []).flatMap(l => l.id === layer.id ? [first, second] : [l])
          return {
            projects: s.projects.map(p => p.id === project.id ? { ...p, audioLayers } : p),
            selectedAudioLayerId: null,
            ...withUndo(s),
          }
        })
      },

      cutAudioLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedAudioLayerId) return s
          const layer = (project.audioLayers ?? []).find(l => l.id === s.selectedAudioLayerId)
          if (!layer) return s
          return {
            audioLayerClipboard: layer,
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, audioLayers: (p.audioLayers ?? []).filter(l => l.id !== layer.id) }
                : p
            ),
            selectedAudioLayerId: null,
            ...withUndo(s),
          }
        })
      },

      copyAudioLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedAudioLayerId) return s
          const layer = (project.audioLayers ?? []).find(l => l.id === s.selectedAudioLayerId)
          if (!layer) return s
          return { audioLayerClipboard: layer }
        })
      },

      pasteAudioLayer: () => {
        set(s => {
          if (!s.audioLayerClipboard) return s
          const project = activeProject(s)
          if (!project) return s
          const newLayer: AudioLayer = { ...s.audioLayerClipboard, id: uid(), startAt: s.playheadTime }
          return {
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, audioLayers: [...(p.audioLayers ?? []), newLayer] }
                : p
            ),
            selectedAudioLayerId: newLayer.id,
            ...withUndo(s),
          }
        })
      },

      duplicateAudioLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedAudioLayerId) return s
          const layer = (project.audioLayers ?? []).find(l => l.id === s.selectedAudioLayerId)
          if (!layer) return s
          const newLayer: AudioLayer = { ...layer, id: uid(), startAt: layer.startAt + (layer.trimEnd - layer.trimStart) }
          return {
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, audioLayers: [...(p.audioLayers ?? []), newLayer] }
                : p
            ),
            selectedAudioLayerId: newLayer.id,
            ...withUndo(s),
          }
        })
      },

      cutOverlayLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedOverlayId) return s
          const layer = (project.overlayLayers ?? []).find(ol => ol.id === s.selectedOverlayId)
          if (!layer) return s
          return {
            overlayClipboard: layer,
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, overlayLayers: (p.overlayLayers ?? []).filter(ol => ol.id !== layer.id) }
                : p
            ),
            selectedOverlayId: null,
            ...withUndo(s),
          }
        })
      },

      copyOverlayLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedOverlayId) return s
          const layer = (project.overlayLayers ?? []).find(ol => ol.id === s.selectedOverlayId)
          if (!layer) return s
          return { overlayClipboard: layer }
        })
      },

      pasteOverlayLayer: () => {
        set(s => {
          if (!s.overlayClipboard) return s
          const project = activeProject(s)
          if (!project) return s
          const newLayer: OverlayLayer = { ...s.overlayClipboard, id: uid(), startAt: s.playheadTime }
          return {
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, overlayLayers: [...(p.overlayLayers ?? []), newLayer] }
                : p
            ),
            selectedOverlayId: newLayer.id,
            ...withUndo(s),
          }
        })
      },

      duplicateOverlayLayer: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedOverlayId) return s
          const layer = (project.overlayLayers ?? []).find(ol => ol.id === s.selectedOverlayId)
          if (!layer) return s
          const newLayer: OverlayLayer = { ...layer, id: uid(), startAt: layer.startAt + layer.duration }
          return {
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, overlayLayers: [...(p.overlayLayers ?? []), newLayer] }
                : p
            ),
            selectedOverlayId: newLayer.id,
            ...withUndo(s),
          }
        })
      },

      detachAudio: (clipId) => {
        set(s => {
          const project = activeProject(s)
          if (!project) return s
          const timings = getClipTimings(project.clips)
          const timing = timings.find(t => t.clip.id === clipId)
          if (!timing) return s
          const source = project.sources.find(src => src.id === timing.clip.sourceId)
          if (!source) return s
          const layer: AudioLayer = {
            id: uid(),
            name: source.name,
            fileName: source.name + '.mp4',
            objectUrl: source.objectUrl,
            blobId: source.id,
            duration: source.duration,
            volume: 1,
            startAt: timing.start,
            trimStart: timing.clip.trimStart,
            trimEnd: timing.clip.trimEnd,
          }
          return {
            projects: s.projects.map(p =>
              p.id === project.id
                ? { ...p, audioLayers: [...(p.audioLayers ?? []), layer] }
                : p
            ),
            ...withUndo(s),
          }
        })
      },

      split: () => {
        set(s => {
          const project = activeProject(s)
          if (!project) return s
          const timings = getClipTimings(project.clips)
          const current = timings.find(t => s.playheadTime > t.start && s.playheadTime < t.end)
          if (!current) return s
          const { clip, start } = current
          const splitPoint = clip.trimStart + (s.playheadTime - start)
          if (splitPoint <= clip.trimStart + 0.01 || splitPoint >= clip.trimEnd - 0.01) return s
          const first: Clip = { ...clip, id: uid(), trimEnd: splitPoint, name: clip.name + ' A' }
          const second: Clip = { ...clip, id: uid(), trimStart: splitPoint, name: clip.name + ' B' }
          const idx = project.clips.findIndex(c => c.id === clip.id)
          const clips = [...project.clips.slice(0, idx), first, second, ...project.clips.slice(idx + 1)]
          const oldCc = s.clipColorCorrections[clip.id]
          return {
            projects: replaceClips(s.projects, project.id, clips),
            selectedClipIds: [],
            clipColorCorrections: oldCc
              ? { ...s.clipColorCorrections, [first.id]: oldCc, [second.id]: oldCc }
              : s.clipColorCorrections,
            ...withUndo(s),
          }
        })
      },

      cut: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedClipIds.length) return s
          const selected = project.clips.filter(c => s.selectedClipIds.includes(c.id))
          const clips = project.clips.filter(c => !s.selectedClipIds.includes(c.id))
          const newDuration = getTotalDuration(clips)
          return {
            clipboard: selected,
            selectedClipIds: [],
            playheadTime: Math.min(s.playheadTime, newDuration),
            projects: replaceClips(s.projects, project.id, clips),
            ...withUndo(s),
          }
        })
      },

      copy: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedClipIds.length) return s
          return { clipboard: project.clips.filter(c => s.selectedClipIds.includes(c.id)) }
        })
      },

      paste: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.clipboard.length) return s
          const timings = getClipTimings(project.clips)
          let insertAfter = project.clips.length - 1
          if (s.selectedClipIds.length > 0) {
            const indices = getSelectedIndices(project.clips, s.selectedClipIds)
            insertAfter = indices[indices.length - 1]
          } else {
            const current = timings.find(t => s.playheadTime >= t.start && s.playheadTime < t.end)
            if (current) insertAfter = current.index
          }
          const newClips = s.clipboard.map(c => ({ ...c, id: uid() }))
          const clips = [
            ...project.clips.slice(0, insertAfter + 1),
            ...newClips,
            ...project.clips.slice(insertAfter + 1),
          ]
          const ccPatch: Record<string, ColorCorrection> = {}
          s.clipboard.forEach((old, i) => {
            const cc = s.clipColorCorrections[old.id]
            if (cc) ccPatch[newClips[i].id] = cc
          })
          return {
            projects: replaceClips(s.projects, project.id, clips),
            selectedClipIds: newClips.map(c => c.id),
            clipColorCorrections: { ...s.clipColorCorrections, ...ccPatch },
            ...withUndo(s),
          }
        })
      },

      duplicate: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedClipIds.length) return s
          const indices = getSelectedIndices(project.clips, s.selectedClipIds)
          const lastIndex = indices[indices.length - 1]
          const originals = indices.map(i => project.clips[i])
          const duplicated = originals.map(c => ({ ...c, id: uid() }))
          const clips = [
            ...project.clips.slice(0, lastIndex + 1),
            ...duplicated,
            ...project.clips.slice(lastIndex + 1),
          ]
          const ccPatch: Record<string, ColorCorrection> = {}
          originals.forEach((old, i) => {
            const cc = s.clipColorCorrections[old.id]
            if (cc) ccPatch[duplicated[i].id] = cc
          })
          return {
            projects: replaceClips(s.projects, project.id, clips),
            selectedClipIds: duplicated.map(c => c.id),
            clipColorCorrections: { ...s.clipColorCorrections, ...ccPatch },
            ...withUndo(s),
          }
        })
      },

      merge: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !canMerge(project.clips, s.selectedClipIds)) return s
          const indices = getSelectedIndices(project.clips, s.selectedClipIds)
          const selected = indices.map(i => project.clips[i])
          const merged: Clip = {
            id: uid(),
            sourceId: selected[0].sourceId,
            name: selected[0].name.replace(/ [AB]$/, ''),
            trimStart: selected[0].trimStart,
            trimEnd: selected[selected.length - 1].trimEnd,
          }
          const clips = [
            ...project.clips.slice(0, indices[0]),
            merged,
            ...project.clips.slice(indices[indices.length - 1] + 1),
          ]
          const firstCc = s.clipColorCorrections[selected[0].id]
          return {
            projects: replaceClips(s.projects, project.id, clips),
            selectedClipIds: [merged.id],
            clipColorCorrections: firstCc
              ? { ...s.clipColorCorrections, [merged.id]: firstCc }
              : s.clipColorCorrections,
            ...withUndo(s),
          }
        })
      },

      deleteSelected: () => {
        set(s => {
          const project = activeProject(s)
          if (!project || !s.selectedClipIds.length) return s
          const clips = project.clips.filter(c => !s.selectedClipIds.includes(c.id))
          const newDuration = getTotalDuration(clips)
          return {
            projects: replaceClips(s.projects, project.id, clips),
            selectedClipIds: [],
            playheadTime: Math.min(s.playheadTime, newDuration),
            ...withUndo(s),
          }
        })
      },

      pushUndo: () => {
        const s = get()
        set({
          undoPast: [...s.undoPast.slice(-9), captureSnapshot(s)],
          undoFuture: [],
        })
      },

      undo: () => set(s => {
        if (!s.undoPast.length) return s
        const current = captureSnapshot(s)
        const prev = s.undoPast[s.undoPast.length - 1]
        return {
          ...prev,
          undoPast: s.undoPast.slice(0, -1),
          undoFuture: [...s.undoFuture.slice(-9), current],
        }
      }),

      redo: () => set(s => {
        if (!s.undoFuture.length) return s
        const current = captureSnapshot(s)
        const next = s.undoFuture[s.undoFuture.length - 1]
        return {
          ...next,
          undoPast: [...s.undoPast.slice(-9), current],
          undoFuture: s.undoFuture.slice(0, -1),
        }
      }),
    }),
    {
      name: 'clipr-store',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // Strip ephemeral state and blob URLs (videos are stored separately in IndexedDB)
      partialize: (s) => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src => ({ ...src, objectUrl: '' })),
          audioLayers: (p.audioLayers ?? []).map(al => ({ ...al, objectUrl: '' })),
          overlayLayers: (p.overlayLayers ?? []).map(ol =>
            ol.type === 'image' ? { ...ol, objectUrl: '' } : ol
          ),
        })),
        outputFormat: s.outputFormat,
        clipCrops: s.clipCrops,
        clipZooms: s.clipZooms,
        clipZoomPresets: s.clipZoomPresets,
        clipTransitionDurations: s.clipTransitionDurations,
        clipTransitionIn: s.clipTransitionIn,
        clipTransitionOut: s.clipTransitionOut,
        clipColorCorrections: s.clipColorCorrections,
        subtitleStyle: s.subtitleStyle,
        subtitleAppearance: s.subtitleAppearance,
        standardSubtitleAppearance: s.standardSubtitleAppearance,
        zoom: s.zoom,
      }),
    }
  )
)
