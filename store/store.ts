import { create } from 'zustand'
import { Clip, ClipBackground, Project, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer, Step } from '@/types'
import { getClipTimings, getTotalDuration, canMerge, getSelectedIndices } from '@/lib/clipUtils'
import { FormatPreset } from '@/lib/formats'
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
  clipSpeeds: Record<string, number>
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
  clipSpeeds: Record<string, number>
  subtitleStyle: SubtitleStyle
  subtitleAppearance: SubtitleAppearance
  standardSubtitleAppearance: StandardSubtitleAppearance

  undoPast: UndoSnapshot[]
  undoFuture: UndoSnapshot[]

  createProject: (name: string, source: SourceVideo) => string
  addSourceToProject: (source: SourceVideo) => void
  addBackgroundClip: (background: ClipBackground) => void
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  hydrateProject: (data: Project & {
    clipCrops?: Record<string, { x: number; y: number }>
    clipZooms?: Record<string, number>
    clipZoomPresets?: Record<string, ZoomPreset>
    clipTransitionDurations?: Record<string, number>
    clipTransitionIn?: Record<string, TransitionType>
    clipTransitionOut?: Record<string, TransitionType>
    clipColorCorrections?: Record<string, ColorCorrection>
    clipSpeeds?: Record<string, number>
    subtitleStyle?: SubtitleStyle
    subtitleAppearance?: SubtitleAppearance
    standardSubtitleAppearance?: StandardSubtitleAppearance
    outputFormat?: FormatPreset | null
  }) => void
  setStepDescription: (projectId: string, stepId: string, description: string) => void
  updateStep: (projectId: string, stepId: string, patch: Partial<Pick<Step, 'title' | 'description' | 'timelinePosition'>>) => void
  addStep: (projectId: string, step: Step) => void
  removeStep: (projectId: string, stepId: string) => void
  moveStep: (projectId: string, stepId: string, newPosition: number) => void
  reorderSteps: (projectId: string, fromIndex: number, toIndex: number) => void
  setActiveProject: (id: string) => void
  setSourceObjectUrl: (sourceId: string, objectUrl: string) => void
  setSourceTranscript: (sourceId: string, transcript: TranscriptSegment[], detectedLanguage?: string) => void
  setSourceTranslation: (sourceId: string, language: string, segments: TranscriptSegment[]) => void
  clearSourceTranslation: (sourceId: string) => void

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
  setClipSpeed: (clipId: string, speed: number) => void
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

  reorderClips: (fromIndex: number, toIndex: number) => void

  pendingFreezeFrame: boolean
  requestFreezeFrame: () => void
  cancelFreezeFrame: () => void
  executeFreezeFrame: (sourceId: string, objectUrl: string, width: number, height: number) => void

  pushUndo: () => void
  undo: () => void
  redo: () => void
}

function uid(): string {
  return crypto.randomUUID()
}

// Split all video clips, audio layers, and overlays at a given timeline time.
// Returns the mutated arrays; leaves segments alone if they don't span that time.
function splitAllAtTime(
  project: Project,
  clipSpeeds: Record<string, number>,
  time: number,
): { clips: Clip[]; audioLayers: AudioLayer[]; overlayLayers: OverlayLayer[] } {
  const timings = getClipTimings(project.clips, clipSpeeds)

  let clips = [...project.clips]
  for (const timing of timings) {
    if (time <= timing.start + 0.01 || time >= timing.end - 0.01) continue
    const { clip } = timing
    const speed = clipSpeeds[clip.id] ?? 1
    const splitPoint = clip.trimStart + (time - timing.start) * speed
    if (splitPoint <= clip.trimStart + 0.01 || splitPoint >= clip.trimEnd - 0.01) continue
    const first: Clip  = { ...clip, id: uid(), trimEnd: splitPoint }
    const second: Clip = { ...clip, id: uid(), trimStart: splitPoint }
    const idx = clips.findIndex(c => c.id === clip.id)
    clips = [...clips.slice(0, idx), first, second, ...clips.slice(idx + 1)]
  }

  const audioLayers: AudioLayer[] = []
  for (const layer of project.audioLayers ?? []) {
    const layerEnd = layer.startAt + (layer.trimEnd - layer.trimStart)
    if (time <= layer.startAt + 0.01 || time >= layerEnd - 0.01) { audioLayers.push(layer); continue }
    const splitSrc = layer.trimStart + (time - layer.startAt)
    if (splitSrc <= layer.trimStart + 0.01 || splitSrc >= layer.trimEnd - 0.01) { audioLayers.push(layer); continue }
    audioLayers.push(
      { ...layer, id: uid(), trimEnd: splitSrc },
      { ...layer, id: uid(), trimStart: splitSrc, startAt: time },
    )
  }

  const overlayLayers: OverlayLayer[] = []
  for (const ol of project.overlayLayers ?? []) {
    const olEnd = ol.startAt + ol.duration
    if (time <= ol.startAt + 0.01 || time >= olEnd - 0.01) { overlayLayers.push(ol); continue }
    const firstDur  = time - ol.startAt
    const secondDur = olEnd - time
    if (firstDur < 0.05 || secondDur < 0.05) { overlayLayers.push(ol); continue }
    overlayLayers.push(
      { ...ol, id: uid(), duration: firstDur },
      { ...ol, id: uid(), startAt: time, duration: secondDur },
    )
  }

  return { clips, audioLayers, overlayLayers }
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
    clipSpeeds: s.clipSpeeds,
  }
}

function withUndo(s: EditorStore): { undoPast: UndoSnapshot[]; undoFuture: UndoSnapshot[] } {
  return {
    undoPast: [...s.undoPast.slice(-9), captureSnapshot(s)],
    undoFuture: [],
  }
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
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
      clipSpeeds: {},
      pendingFreezeFrame: false,
      subtitleStyle: 'off' as SubtitleStyle,
      subtitleAppearance: SUBTITLE_DEFAULT,
      standardSubtitleAppearance: STANDARD_SUBTITLE_DEFAULT,
      undoPast: [],
      undoFuture: [],

      createProject: (name, source) => {
        const id = uid()
        const clipId = uid()
        const clip: Clip = { id: clipId, sourceId: source.id, name: source.name, trimStart: 0, trimEnd: source.duration }
        const step: Step = { id: uid(), clipId, sourceId: source.id, title: name, description: '', timelinePosition: 0 }
        const project: Project = { id, name, createdAt: Date.now(), clips: [clip], sources: [source], audioLayers: [], overlayLayers: [], steps: [step] }
        set(s => ({ projects: [...s.projects, project] }))
        return id
      },

      renameProject: (id, name) => set(s => ({
        projects: s.projects.map(p => p.id === id ? { ...p, name } : p),
      })),

      addSourceToProject: (source) => set(s => {
        const project = activeProject(s)
        if (!project) return s
        const clip: Clip = { id: uid(), sourceId: source.id, name: source.name, trimStart: 0, trimEnd: source.duration }
        return {
          projects: s.projects.map(p =>
            p.id === project.id
              ? { ...p, sources: [...p.sources, source], clips: [...p.clips, clip] }
              : p
          ),
          ...withUndo(s),
        }
      }),

      addBackgroundClip: (background) => set(s => {
        const project = activeProject(s)
        if (!project) return s
        const clip: Clip = { id: uid(), sourceId: '', name: 'Background', trimStart: 0, trimEnd: 3, background }
        return {
          projects: replaceClips(s.projects, project.id, [...project.clips, clip]),
          ...withUndo(s),
        }
      }),

      hydrateProject: (data) => set(s => {
        const project: Project = {
          id: data.id, name: data.name, createdAt: data.createdAt,
          clips: data.clips, sources: data.sources,
          audioLayers: data.audioLayers, overlayLayers: data.overlayLayers,
          steps: data.steps,
        }
        return {
          projects: s.projects.some(p => p.id === project.id)
            ? s.projects.map(p => p.id === project.id ? project : p)
            : [...s.projects, project],
          ...(data.clipCrops !== undefined && { clipCrops: { ...s.clipCrops, ...data.clipCrops } }),
          ...(data.clipZooms !== undefined && { clipZooms: { ...s.clipZooms, ...data.clipZooms } }),
          ...(data.clipZoomPresets !== undefined && { clipZoomPresets: { ...s.clipZoomPresets, ...data.clipZoomPresets } }),
          ...(data.clipTransitionDurations !== undefined && { clipTransitionDurations: { ...s.clipTransitionDurations, ...data.clipTransitionDurations } }),
          ...(data.clipTransitionIn !== undefined && { clipTransitionIn: { ...s.clipTransitionIn, ...data.clipTransitionIn } }),
          ...(data.clipTransitionOut !== undefined && { clipTransitionOut: { ...s.clipTransitionOut, ...data.clipTransitionOut } }),
          ...(data.clipColorCorrections !== undefined && { clipColorCorrections: { ...s.clipColorCorrections, ...data.clipColorCorrections } }),
          ...(data.clipSpeeds !== undefined && { clipSpeeds: { ...s.clipSpeeds, ...data.clipSpeeds } }),
          ...(data.subtitleStyle !== undefined && { subtitleStyle: data.subtitleStyle }),
          ...(data.subtitleAppearance !== undefined && { subtitleAppearance: data.subtitleAppearance }),
          ...(data.standardSubtitleAppearance !== undefined && { standardSubtitleAppearance: data.standardSubtitleAppearance }),
          ...(data.outputFormat !== undefined && { outputFormat: data.outputFormat }),
        }
      }),

      deleteProject: (id) => {
        set(s => ({
          projects: s.projects.filter(p => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }))
      },

      setStepDescription: (projectId, stepId, description) => set(s => ({
        projects: s.projects.map(p =>
          p.id !== projectId ? p : {
            ...p,
            steps: (p.steps ?? []).map(st =>
              st.id === stepId ? { ...st, description } : st
            ),
          }
        ),
      })),

      updateStep: (projectId, stepId, patch) => set(s => ({
        projects: s.projects.map(p =>
          p.id !== projectId ? p : {
            ...p,
            steps: (p.steps ?? []).map(st =>
              st.id === stepId ? { ...st, ...patch } : st
            ),
          }
        ),
      })),

      addStep: (projectId, step) => set(s => {
        const project = s.projects.find(p => p.id === projectId)
        if (!project) return s
        if ((project.steps ?? []).length >= 20) return s

        const time = step.timelinePosition
        const newSteps = [...(project.steps ?? []), step].sort((a, b) =>
          (a.timelinePosition ?? 0) - (b.timelinePosition ?? 0)
        )

        if (time === undefined) {
          return { projects: s.projects.map(p => p.id === projectId ? { ...p, steps: newSteps } : p) }
        }

        const { clips, audioLayers, overlayLayers } = splitAllAtTime(project, s.clipSpeeds, time)
        return {
          projects: s.projects.map(p =>
            p.id === projectId ? { ...p, clips, audioLayers, overlayLayers, steps: newSteps } : p
          ),
          ...withUndo(s),
        }
      }),

      removeStep: (projectId, stepId) => set(s => ({
        projects: s.projects.map(p =>
          p.id === projectId
            ? { ...p, steps: (p.steps ?? []).filter(st => st.id !== stepId) }
            : p
        ),
        ...withUndo(s),
      })),

      moveStep: (projectId, stepId, newPosition) => set(s => {
        const project = s.projects.find(p => p.id === projectId)
        if (!project) return s

        const { clips, audioLayers, overlayLayers } = splitAllAtTime(project, s.clipSpeeds, newPosition)
        const steps = (project.steps ?? [])
          .map(st => st.id === stepId ? { ...st, timelinePosition: newPosition } : st)
          .sort((a, b) => (a.timelinePosition ?? 0) - (b.timelinePosition ?? 0))

        return {
          projects: s.projects.map(p =>
            p.id === projectId ? { ...p, clips, audioLayers, overlayLayers, steps } : p
          ),
          ...withUndo(s),
        }
      }),

      reorderSteps: (projectId, fromIndex, toIndex) => set(s => {
        const project = s.projects.find(p => p.id === projectId)
        if (!project || fromIndex === toIndex) return s
        const baseTimings = getClipTimings(project.clips, s.clipSpeeds)
        function resolvePos(st: Step): number {
          if (st.timelinePosition !== undefined) return st.timelinePosition
          return baseTimings.find(t => t.clip.id === st.clipId)?.start ?? 0
        }
        const sorted = [...(project.steps ?? [])].sort((a, b) => resolvePos(a) - resolvePos(b))
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return s

        const timings = baseTimings
        const totalDuration = timings.length > 0 ? timings[timings.length - 1].end : 0

        // Region boundaries: [pos0, pos1, ..., posN, totalDuration]
        const positions = sorted.map(st => resolvePos(st))
        const boundaries = [...positions, totalDuration]
        const regionDurations = sorted.map((_, i) => boundaries[i + 1] - boundaries[i])

        // origIndices[j] = which original region is at new position j after the move
        const origIndices = sorted.map((_, i) => i)
        const [movedIdx] = origIndices.splice(fromIndex, 1)
        origIndices.splice(toIndex, 0, movedIdx)

        // New start time for each new-order slot
        const newPositions: number[] = []
        let cum = 0
        for (const oi of origIndices) {
          newPositions.push(cum)
          cum += regionDurations[oi]
        }

        // Reverse map: origRegionToNewStart[i] = new timeline start of original region i
        const origRegionToNewStart: number[] = new Array(sorted.length)
        for (let j = 0; j < origIndices.length; j++) {
          origRegionToNewStart[origIndices[j]] = newPositions[j]
        }

        // Remap a timeline time from the old layout to the new one
        function remapTime(t: number): number {
          for (let i = 0; i < sorted.length; i++) {
            if (t >= boundaries[i] - 0.001 && t < boundaries[i + 1] + 0.001) {
              return origRegionToNewStart[i] + (t - positions[i])
            }
          }
          return t
        }

        // Reorder clip groups
        const clipGroups: Clip[][] = sorted.map((_, i) =>
          timings
            .filter(t => t.start >= boundaries[i] - 0.001 && t.start < boundaries[i + 1] - 0.001)
            .map(t => t.clip)
        )
        const clips = origIndices.flatMap(oi => clipGroups[oi])

        // Remap audio and overlay layer start times
        const audioLayers = (project.audioLayers ?? []).map(l => ({ ...l, startAt: remapTime(l.startAt) }))
        const overlayLayers = (project.overlayLayers ?? []).map(ol => ({ ...ol, startAt: remapTime(ol.startAt) }))

        // Steps keep their identity (title/description) but get new (explicit) timeline positions
        const steps = origIndices.map((oi, j) => ({ ...sorted[oi], timelinePosition: newPositions[j] }))

        return {
          projects: s.projects.map(p =>
            p.id === projectId ? { ...p, clips, audioLayers, overlayLayers, steps } : p
          ),
          ...withUndo(s),
        }
      }),

      setActiveProject: (id) => {
        set({ activeProjectId: id, selectedClipIds: [], selectedAudioLayerId: null, selectedOverlayId: null, playheadTime: 0, isPlaying: false })
      },

      setSourceObjectUrl: (sourceId, objectUrl) => set(s => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src =>
            src.id === sourceId ? { ...src, objectUrl } : src
          ),
        })),
      })),

      setSourceTranscript: (sourceId, transcript, detectedLanguage) => set(s => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src =>
            src.id === sourceId
              ? { ...src, transcript, ...(detectedLanguage ? { detectedLanguage } : {}) }
              : src
          ),
        })),
      })),

      setSourceTranslation: (sourceId, language, segments) => set(s => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src =>
            src.id === sourceId
              ? { ...src, translationLanguage: language, translatedTranscript: segments }
              : src
          ),
        })),
      })),

      clearSourceTranslation: (sourceId) => set(s => ({
        projects: s.projects.map(p => ({
          ...p,
          sources: p.sources.map(src =>
            src.id === sourceId
              ? { ...src, translationLanguage: undefined, translatedTranscript: undefined }
              : src
          ),
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
      setClipSpeed: (clipId, speed) => set(s => ({
        clipSpeeds: { ...s.clipSpeeds, [clipId]: speed },
        ...withUndo(s),
      })),
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
          const timings = getClipTimings(project.clips, s.clipSpeeds)
          const timing = timings.find(t => t.clip.id === clipId)
          if (!timing) return s
          const source = project.sources.find(src => src.id === timing.clip.sourceId)
          if (!source) return s
          const layer: AudioLayer = {
            id: uid(),
            name: source.name,
            fileName: source.name + '.mp4',
            objectUrl: source.objectUrl,
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
          const timings = getClipTimings(project.clips, s.clipSpeeds)
          const current = timings.find(t => s.playheadTime > t.start && s.playheadTime < t.end)
          if (!current) return s
          const { clip, start } = current
          const speed = s.clipSpeeds[clip.id] ?? 1
          const splitPoint = clip.trimStart + (s.playheadTime - start) * speed
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
          const timings = getClipTimings(project.clips, s.clipSpeeds)
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

      reorderClips: (fromIndex, toIndex) => set(s => {
        const project = activeProject(s)
        if (!project || fromIndex === toIndex) return s
        const clips = [...project.clips]
        const [removed] = clips.splice(fromIndex, 1)
        clips.splice(toIndex, 0, removed)
        return {
          projects: replaceClips(s.projects, project.id, clips),
          ...withUndo(s),
        }
      }),

      requestFreezeFrame: () => set({ pendingFreezeFrame: true }),
      cancelFreezeFrame: () => set({ pendingFreezeFrame: false }),
      executeFreezeFrame: (sourceId, objectUrl, width, height) => set(s => {
        const project = activeProject(s)
        if (!project) return { pendingFreezeFrame: false }

        const source: import('@/types').SourceVideo = {
          id: sourceId, name: 'Freeze Frame', duration: 4, width, height, objectUrl, isImage: true,
        }
        const freezeClip: Clip = { id: uid(), sourceId, name: 'Freeze Frame', trimStart: 0, trimEnd: 4 }

        const timings = getClipTimings(project.clips, s.clipSpeeds)
        const t = s.playheadTime
        const current = timings.find(tm => t > tm.start + 0.01 && t < tm.end - 0.01)

        let newClips: Clip[]
        if (current) {
          const { clip: c, start } = current
          const speed = s.clipSpeeds[c.id] ?? 1
          const splitPoint = c.trimStart + (t - start) * speed
          const idx = project.clips.findIndex(cl => cl.id === c.id)
          if (splitPoint <= c.trimStart + 0.01 || splitPoint >= c.trimEnd - 0.01) {
            newClips = [...project.clips.slice(0, idx + 1), freezeClip, ...project.clips.slice(idx + 1)]
          } else {
            const first:  Clip = { ...c, id: uid(), trimEnd: splitPoint }
            const second: Clip = { ...c, id: uid(), trimStart: splitPoint }
            newClips = [...project.clips.slice(0, idx), first, freezeClip, second, ...project.clips.slice(idx + 1)]
          }
        } else {
          let insertIdx = project.clips.length - 1
          for (let i = timings.length - 1; i >= 0; i--) {
            if (timings[i].end <= t) { insertIdx = timings[i].index; break }
          }
          newClips = [...project.clips.slice(0, insertIdx + 1), freezeClip, ...project.clips.slice(insertIdx + 1)]
        }

        return {
          pendingFreezeFrame: false,
          projects: s.projects.map(p =>
            p.id === project.id
              ? { ...p, sources: [...p.sources, source], clips: newClips }
              : p
          ),
          ...withUndo(s),
        }
      }),

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
    }))
