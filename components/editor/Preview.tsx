'use client'

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import type { ShapeLayer } from '@/types'
import { useEditorStore } from '@/store/store'
import { ZoomPreset, TransitionType } from '@/store/store'
import { getClipTimings, formatTime } from '@/lib/clipUtils'
import { ClipTiming } from '@/lib/clipUtils'
import { hexToRgba } from '@/lib/subtitleTemplates'
import { toCssFilter, COLOR_CORRECTION_DEFAULT } from '@/lib/colorPresets'
import CCSelector from './CCSelector'
import { SubtitlePosition } from '@/store/store'

// Stable empty-array constants — prevents `?? []` from creating new references
// on every render, which would break useSyncExternalStore and cause infinite loops.
const EMPTY_CC_SEGMENTS: never[] = []

function subPositionClass(pos: SubtitlePosition): string {
  switch (pos) {
    case 'top':    return 'absolute top-6 left-0 right-0 flex justify-center pointer-events-none px-4'
    case 'left':   return 'absolute top-1/2 left-4 -translate-y-1/2 flex justify-start pointer-events-none max-w-[40%]'
    case 'right':  return 'absolute top-1/2 right-4 -translate-y-1/2 flex justify-end pointer-events-none max-w-[40%]'
    default:       return 'absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-4'
  }
}

function calcAnimatedState(
  preset: ZoomPreset,
  progress: number,
  targetZoom: number,
  crop: { x: number; y: number },
  transitionSec: number,
  clipDuration: number
): { scale: number; cropX: number; cropY: number } {
  const p = Math.max(0, Math.min(1, progress))
  if (preset === 'punch') {
    // Convert transition seconds to a fraction of clip duration, capped so there's always a hold in the middle
    const ph = clipDuration > 0 ? Math.min(transitionSec / clipDuration, 0.45) : 0.2
    let scale: number
    if (p < ph) {
      const t = p / ph
      scale = 1 + (targetZoom - 1) * (1 - (1 - t) ** 2)
    } else if (p > 1 - ph) {
      const t = (p - (1 - ph)) / ph
      scale = targetZoom - (targetZoom - 1) * (t * t)
    } else {
      scale = targetZoom
    }
    return { scale, cropX: crop.x, cropY: crop.y }
  }
  if (preset === 'ken-burns') {
    const endX = 100 - crop.x
    const endY = 100 - crop.y
    return {
      scale: 1 + (targetZoom - 1) * p,
      cropX: crop.x + (endX - crop.x) * p,
      cropY: crop.y + (endY - crop.y) * p,
    }
  }
  return { scale: targetZoom, cropX: crop.x, cropY: crop.y }
}

function applyVideoState(
  video: HTMLVideoElement,
  scale: number,
  cropX: number,
  cropY: number,
  hasFormat: boolean,
  slideX = 0,
  slideY = 0,
) {
  const parts: string[] = []
  if (slideX !== 0 || slideY !== 0) parts.push(`translate(${slideX.toFixed(1)}%, ${slideY.toFixed(1)}%)`)
  if (scale !== 1) parts.push(`scale(${scale})`)
  video.style.transform = parts.join(' ')
  video.style.transformOrigin = `${cropX}% ${cropY}%`
  if (hasFormat) video.style.objectPosition = `${cropX}% ${cropY}%`
}

function computeTransitionState(
  timeInClip: number,
  clipDuration: number,
  transitionIn: TransitionType,
  transitionOut: TransitionType,
  transitionDuration: number,
): { fadeOpacity: number; slideX: number; slideY: number; blurPx: number } {
  const td = Math.max(0.01, Math.min(transitionDuration, clipDuration * 0.45))
  let fadeOpacity = 0, slideX = 0, slideY = 0, blurPx = 0

  if (transitionIn !== 'none' && timeInClip < td) {
    const p = Math.max(0, Math.min(1, timeInClip / td))  // 0 → 1
    switch (transitionIn) {
      case 'fade':         fadeOpacity = Math.max(fadeOpacity, 1 - p); break
      case 'slide-left':   slideX = -(1 - p) * 100; break
      case 'slide-right':  slideX = (1 - p) * 100; break
      case 'slide-top':    slideY = -(1 - p) * 100; break
      case 'slide-bottom': slideY = (1 - p) * 100; break
      case 'blur':         blurPx = Math.max(blurPx, (1 - p) * 20); break
    }
  }

  if (transitionOut !== 'none' && timeInClip > clipDuration - td) {
    const p = Math.max(0, Math.min(1, (clipDuration - timeInClip) / td))  // 1 → 0
    switch (transitionOut) {
      case 'fade':         fadeOpacity = Math.max(fadeOpacity, 1 - p); break
      case 'slide-left':   slideX = -(1 - p) * 100; break
      case 'slide-right':  slideX = (1 - p) * 100; break
      case 'slide-top':    slideY = -(1 - p) * 100; break
      case 'slide-bottom': slideY = (1 - p) * 100; break
      case 'blur':         blurPx = Math.max(blurPx, (1 - p) * 20); break
    }
  }

  return { fadeOpacity, slideX, slideY, blurPx }
}

const EMPTY_CLIPS: import('@/types').Clip[] = []
const EMPTY_SOURCES: import('@/types').SourceVideo[] = []
const EMPTY_AUDIO_LAYERS: import('@/types').AudioLayer[] = []
const EMPTY_OVERLAY_LAYERS: import('@/types').OverlayLayer[] = []
const EMPTY_SHAPE_LAYERS: import('@/types').ShapeLayer[] = []
const EMPTY_HIDE_LAYERS: import('@/types').HideLayer[] = []

// Each handle: [relX, relY] (0=left/top, 0.5=mid, 1=right/bottom), cursor
const RESIZE_HANDLES: [number, number, string][] = [
  [0,   0,   'nw-resize'],
  [0.5, 0,   'n-resize' ],
  [1,   0,   'ne-resize'],
  [1,   0.5, 'e-resize' ],
  [1,   1,   'se-resize'],
  [0.5, 1,   's-resize' ],
  [0,   1,   'sw-resize'],
  [0,   0.5, 'w-resize' ],
]

// Draws the rectangle stroke as a clockwise draw-on animation starting from the top-right corner.
// Measures the SVG viewport after mount so arc radii are in actual pixels.
function ShapeStroke({ shape }: { shape: ShapeLayer }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [d, setD] = useState('')

  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return
    const { width: W, height: H } = el.getBoundingClientRect()
    const r = Math.max(0, Math.min(shape.borderRadius, W / 2, H / 2))
    if (r <= 0) {
      setD(`M ${W},0 L ${W},${H} L 0,${H} L 0,0 Z`)
    } else {
      setD(
        `M ${W - r},0 A ${r},${r} 0 0,1 ${W},${r} ` +
        `L ${W},${H - r} A ${r},${r} 0 0,1 ${W - r},${H} ` +
        `L ${r},${H} A ${r},${r} 0 0,1 0,${H - r} ` +
        `L 0,${r} A ${r},${r} 0 0,1 ${r},0 Z`
      )
    }
  }, [shape.width, shape.height, shape.borderRadius])

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {d && (
        <path
          d={d}
          pathLength="1"
          fill="none"
          stroke={shape.strokeColor}
          strokeOpacity={shape.strokeOpacity}
          strokeWidth={shape.strokeWidth}
          strokeDasharray="1"
          strokeDashoffset="1"
          className="shape-draw-on"
        />
      )}
    </svg>
  )
}

// Two rings expanding and fading — using CSS animation (rippleExpand in globals.css)
function RippleStroke({ shape }: { shape: ShapeLayer }) {
  // r="50%" exactly fills the square shape div (SVG % r uses normalized diagonal = side for squares).
  // Each ring has a slight fill (12% of its stroke opacity) that fades with the ring — gives the
  // soft "glow" seen on phone recording indicators.
  // The static center dot mimics the solid recording dot on mobile.
  return (
    <svg
      width="100%" height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <circle
        cx="50%" cy="50%" r="50%"
        fill={shape.strokeColor} fillOpacity={0.12 * shape.strokeOpacity}
        stroke={shape.strokeColor} strokeOpacity={shape.strokeOpacity}
        strokeWidth={shape.strokeWidth}
        className="ripple-ring ripple-ring-1"
      />
      <circle
        cx="50%" cy="50%" r="50%"
        fill={shape.strokeColor} fillOpacity={0.12 * shape.strokeOpacity}
        stroke={shape.strokeColor} strokeOpacity={shape.strokeOpacity}
        strokeWidth={shape.strokeWidth}
        className="ripple-ring ripple-ring-2"
      />
      {/* Static center dot */}
      <circle
        cx="50%" cy="50%" r="5%"
        fill={shape.strokeColor} fillOpacity={0.9 * shape.strokeOpacity}
        stroke="none"
      />
    </svg>
  )
}

export default function Preview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef   = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const transitionOverlayRef = useRef<HTMLDivElement>(null)
  const activeClipIdxRef = useRef<number>(0)
  const lastSyncRef = useRef<number>(0)
  const animRafRef = useRef<number>(0)
  const imageClipWallStartRef     = useRef<number>(0)
  const imageClipPlayheadStartRef = useRef<number>(0)
  const dragRef = useRef<{ startX: number; startY: number; cropX: number; cropY: number; clipId: string } | null>(null)
  const overlayDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; id: string } | null>(null)
  const shapeDragRef = useRef<
    | { id: string; mode: 'move'; startX: number; startY: number; ox: number; oy: number }
    | { id: string; mode: 'resize'; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number; fixedX: number; fixedY: number; movingStartX: number; movingStartY: number; affectsX: boolean; affectsY: boolean }
    | null
  >(null)

  const hideDragRef = useRef<
    | { id: string; mode: 'move'; startX: number; startY: number; ox: number; oy: number }
    | { id: string; mode: 'resize'; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number; fixedX: number; fixedY: number; movingStartX: number; movingStartY: number; affectsX: boolean; affectsY: boolean }
    | null
  >(null)

  const clips       = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? EMPTY_CLIPS)
  const sources     = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.sources ?? EMPTY_SOURCES)
  const sourcesReady = useEditorStore(s => {
    const project = s.projects.find(p => p.id === s.activeProjectId)
    if (!project?.sources.length) return true
    // A source is ready if it has an objectUrl, OR if it has no s3Key (can't be fetched — e.g. freeze frames after reload)
    return project.sources.every(src => !!src.objectUrl || !src.s3Key)
  })
  const audioLayers = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.audioLayers ?? EMPTY_AUDIO_LAYERS)
  const overlayLayers = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.overlayLayers ?? EMPTY_OVERLAY_LAYERS)
  const selectedOverlayId = useEditorStore(s => s.selectedOverlayId)
  const setSelectedOverlayId = useEditorStore(s => s.setSelectedOverlayId)
  const updateOverlayLayer = useEditorStore(s => s.updateOverlayLayer)
  const playheadTime = useEditorStore(s => s.playheadTime)
  const previewTime = useEditorStore(s => s.previewTime)
  const isPlaying = useEditorStore(s => s.isPlaying)
  const outputFormat = useEditorStore(s => s.outputFormat)
  const clipCrops = useEditorStore(s => s.clipCrops)
  const clipZooms = useEditorStore(s => s.clipZooms)
  const clipZoomPresets = useEditorStore(s => s.clipZoomPresets)
  const clipTransitionDurations = useEditorStore(s => s.clipTransitionDurations)
  const clipTransitionIn  = useEditorStore(s => s.clipTransitionIn)
  const clipTransitionOut = useEditorStore(s => s.clipTransitionOut)
  const clipColorCorrections = useEditorStore(s => s.clipColorCorrections)
  const clipSpeeds = useEditorStore(s => s.clipSpeeds)
  const subtitleStyle    = useEditorStore(s => s.subtitleStyle)
  const subtitlePosition = useEditorStore(s => s.subtitlePosition)
  const subtitleFontSize = useEditorStore(s => s.subtitleFontSize)
  const subtitleAppearance = useEditorStore(s => s.subtitleAppearance)
  const standardSubtitleAppearance = useEditorStore(s => s.standardSubtitleAppearance)
  const setPlayhead = useEditorStore(s => s.setPlayhead)
  const setPlaying = useEditorStore(s => s.setPlaying)
  const setClipCrop = useEditorStore(s => s.setClipCrop)
  const pushUndo    = useEditorStore(s => s.pushUndo)
  const pendingFreezeFrame  = useEditorStore(s => s.pendingFreezeFrame)
  const executeFreezeFrame  = useEditorStore(s => s.executeFreezeFrame)
  const cancelFreezeFrame   = useEditorStore(s => s.cancelFreezeFrame)
  const shapeLayers        = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.shapeLayers ?? EMPTY_SHAPE_LAYERS)
  const hideLayers             = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.hideLayers ?? EMPTY_HIDE_LAYERS)
  const selectedHideLayerId    = useEditorStore(s => s.selectedHideLayerId)
  const setSelectedHideLayerId = useEditorStore(s => s.setSelectedHideLayerId)
  const updateHideLayer        = useEditorStore(s => s.updateHideLayer)
  const selectedShapeId    = useEditorStore(s => s.selectedShapeId)
  const setSelectedShapeId = useEditorStore(s => s.setSelectedShapeId)
  const updateShapeLayer   = useEditorStore(s => s.updateShapeLayer)
  const timings = getClipTimings(clips, clipSpeeds)
  const totalDuration = timings.length > 0 ? timings[timings.length - 1].end : 0
  const clipKey = clips.map(c => `${c.id}:${c.trimStart}:${c.trimEnd}:${clipSpeeds[c.id] ?? 1}`).join('|')

  // Which clip the playhead is currently in
  const activeTiming: ClipTiming | null =
    timings.find(t => (previewTime ?? playheadTime) >= t.start && (previewTime ?? playheadTime) < t.end) ??
    timings[timings.length - 1] ??
    null
  const activeClipId = activeTiming?.clip.id ?? null
  const activeClipBackground = activeTiming?.clip.background ?? null
  const currentCrop = activeClipId ? (clipCrops[activeClipId] ?? { x: 50, y: 50 }) : { x: 50, y: 50 }
  const currentZoom = activeClipId ? (clipZooms[activeClipId] ?? 1) : 1

  const activeSource = activeTiming
    ? sources.find(s => s.id === activeTiming.clip.sourceId)
    : null

  // Reactive display flags — these drive show/hide for <video> and <img> so
  // React's reconciler is always the source of truth (avoids conflict with imperative applyClip mutations)
  const isImageClip      = !!activeSource?.isImage
  const isBackgroundClip = !!activeClipBackground

  // Subtitles: use ccSegments (timeline-time based) for direct lookup — no source-time mapping needed
  const ccSegments  = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.ccSegments ?? EMPTY_CC_SEGMENTS)
  const t           = previewTime ?? playheadTime
  const activeSegment = ccSegments.find(seg => t >= seg.startAt && t < seg.endAt) ?? null
  const hasCc       = ccSegments.length > 0

  // For highlight mode: find current word and build a 4-word display window
  const words = activeSegment?.words ?? []
  const currentWordIdx = words.findIndex(w => t >= w.startAt && t < w.endAt)
  const anchorIdx = currentWordIdx >= 0
    ? currentWordIdx
    : words.findLastIndex(w => w.startAt <= t)
  const windowStart = Math.max(0, anchorIdx - 1)
  const windowEnd = Math.min(words.length, windowStart + 4)
  const displayWords = words.slice(windowStart, windowEnd)

  // Aspect ratio for the preview container — always constrained so background/image clips
  // don't stretch to fill the entire preview area.
  const previewAspect = outputFormat
    ? outputFormat.aspectW / outputFormat.aspectH
    : (() => {
        // Fall back to the first real video source's dimensions, then 16:9
        const firstVideoSrc = sources.find(src => !src.isImage && clips.some(c => c.sourceId === src.id))
        if (firstVideoSrc?.width && firstVideoSrc?.height) return firstVideoSrc.width / firstVideoSrc.height
        return 16 / 9
      })()

  // Mutable ref so RAF/timeupdate always see the latest sources without re-registering effects
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  // Audio layer elements — managed imperatively so the RAF/timeupdate callbacks don't need to re-register
  const audioLayersRef    = useRef(audioLayers)
  const audioElementsRef  = useRef<Map<string, HTMLAudioElement>>(new Map())
  audioLayersRef.current  = audioLayers

  // Mutable refs so RAF/timeupdate callbacks always see latest values without re-registering
  const clipCropsRef = useRef(clipCrops)
  const clipZoomsRef = useRef(clipZooms)
  const clipZoomPresetsRef = useRef(clipZoomPresets)
  const clipTransitionDurationsRef = useRef(clipTransitionDurations)
  const clipTransitionInRef  = useRef(clipTransitionIn)
  const clipTransitionOutRef = useRef(clipTransitionOut)
  const clipColorCorrectionsRef = useRef(clipColorCorrections)
  const clipSpeedsRef = useRef(clipSpeeds)
  const outputFormatRef = useRef(outputFormat)
  const timingsRef = useRef(timings)
  clipCropsRef.current = clipCrops
  clipZoomsRef.current = clipZooms
  clipZoomPresetsRef.current = clipZoomPresets
  clipTransitionDurationsRef.current = clipTransitionDurations
  clipTransitionInRef.current  = clipTransitionIn
  clipTransitionOutRef.current = clipTransitionOut
  clipColorCorrectionsRef.current = clipColorCorrections
  clipSpeedsRef.current = clipSpeeds
  outputFormatRef.current = outputFormat
  timingsRef.current = timings

  // Manage Audio elements for audio layers
  useEffect(() => {
    const map = audioElementsRef.current
    const ids = new Set(audioLayers.map(l => l.id))
    // Remove deleted layers
    for (const [id, el] of map) {
      if (!ids.has(id)) { el.pause(); el.src = ''; map.delete(id) }
    }
    // Add / update
    for (const layer of audioLayers) {
      let el = map.get(layer.id)
      if (!el) { el = new Audio(); map.set(layer.id, el) }
      if (el.src !== layer.objectUrl) el.src = layer.objectUrl
      el.volume = layer.volume
    }
  }, [audioLayers])

  // Freeze frame capture — fires when Toolbar/keyboard sets pendingFreezeFrame
  useEffect(() => {
    if (!pendingFreezeFrame) return
    const video = videoRef.current
    if (!video || !video.videoWidth) { cancelFreezeFrame(); return }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { cancelFreezeFrame(); return }
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(async blob => {
      if (!blob) { cancelFreezeFrame(); return }
      const sourceId = crypto.randomUUID()
      const objectUrl = URL.createObjectURL(blob)

      // Upload to S3 so the frame survives page reloads
      let s3Key: string | undefined
      try {
        const urlRes = await fetch('/api/sources/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, fileName: 'freeze.jpg', contentType: 'image/jpeg' }),
        })
        if (urlRes.ok) {
          const { uploadUrl, s3Key: key } = await urlRes.json()
          await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
          s3Key = key
        }
      } catch {
        // Upload failure is non-fatal — frame still works in current session
      }

      executeFreezeFrame(sourceId, objectUrl, canvas.width, canvas.height, s3Key)
    }, 'image/jpeg', 0.95)
  }, [pendingFreezeFrame]) // eslint-disable-line react-hooks/exhaustive-deps

  function syncAudioToTime(t: number, play: boolean) {
    for (const layer of audioLayersRef.current) {
      const el = audioElementsRef.current.get(layer.id)
      if (!el || !el.src) continue
      const offset   = t - layer.startAt
      const layerEnd = layer.startAt + (layer.trimEnd - layer.trimStart)
      const inRange  = offset >= 0 && t < layerEnd
      if (inRange) {
        const sourceTime = layer.trimStart + offset
        let vol = layer.volume
        const fadeIn  = layer.fadeIn  ?? 0
        const fadeOut = layer.fadeOut ?? 0
        if (fadeIn  > 0 && offset < fadeIn)              vol *= offset / fadeIn
        if (fadeOut > 0 && (layerEnd - t) < fadeOut)     vol *= (layerEnd - t) / fadeOut
        el.volume = Math.max(0, Math.min(1, vol))
        if (Math.abs(el.currentTime - sourceTime) > 0.15) el.currentTime = sourceTime
        if (play && el.paused) el.play().catch(() => {})
      } else {
        if (!el.paused) el.pause()
      }
    }
  }

  function pauseAllAudio() {
    for (const [, el] of audioElementsRef.current) el.pause()
  }

  function findTiming(t: number): ClipTiming | null {
    return timings.find(timing => t >= timing.start && t < timing.end) ?? timings[timings.length - 1] ?? null
  }

  function applyClip(clipIdx: number, seekTo: number) {
    const video = videoRef.current
    if (!video) return
    const timing = timingsRef.current[clipIdx]
    if (!timing) return
    activeClipIdxRef.current = clipIdx
    if (timing.clip.background) {
      // Don't clear video.src — retaining it keeps the container's intrinsic size intact
      // so the aspect-ratio container doesn't collapse when no video content is shown.
      return
    }
    const source = sourcesRef.current.find(s => s.id === timing.clip.sourceId)
    if (!source) return
    if (source.isImage) {
      // Freeze frame — img src/display are handled reactively.
      // Don't clear video.src — retaining it keeps the container's intrinsic size intact.
      return
    }
    // Normal video clip — display handled reactively; just set src/time
    if (video.src !== source.objectUrl) video.src = source.objectUrl
    video.muted = audioLayersRef.current.some(l => l.detachedFromSourceId === source.id)
    video.currentTime = seekTo
    video.playbackRate = clipSpeedsRef.current[timing.clip.id] ?? 1
    const cc = clipColorCorrectionsRef.current[timing.clip.id] ?? COLOR_CORRECTION_DEFAULT
    video.style.filter = toCssFilter(cc)
  }

  // Seek + apply visual state when paused / scrubbing
  useEffect(() => {
    if (isPlaying) return
    const video = videoRef.current
    if (!video) return
    const t = previewTime ?? playheadTime
    const timing = findTiming(t)
    if (!timing) {
      video.style.transform = ''
      if (transitionOverlayRef.current) transitionOverlayRef.current.style.opacity = '0'
      return
    }
    // For image/background clips, skip video-specific state and reset overlays
    const source = timing.clip.background ? null : sourcesRef.current.find(s => s.id === timing.clip.sourceId)
    if (source?.isImage || timing.clip.background) {
      applyClip(timing.index, 0)
      activeClipIdxRef.current = timing.index
      video.style.transform = ''
      if (transitionOverlayRef.current) transitionOverlayRef.current.style.opacity = '0'
      syncAudioToTime(t, false)
      return
    }
    applyClip(timing.index, timing.clip.trimStart + (t - timing.start))
    const { clip } = timing
    const dur = clip.trimEnd - clip.trimStart
    const p = dur > 0 ? (t - timing.start) / dur : 0
    const preset = clipZoomPresets[clip.id] ?? 'none'
    const targetZoom = clipZooms[clip.id] ?? 1
    const crop = clipCrops[clip.id] ?? { x: 50, y: 50 }
    const transitionSec = clipTransitionDurations[clip.id] ?? 0.5
    const { scale, cropX, cropY } = calcAnimatedState(preset, p, targetZoom, crop, transitionSec, dur)
    const timeInClip = t - timing.start
    const tIn  = clipTransitionIn[clip.id]  ?? 'none'
    const tOut = clipTransitionOut[clip.id] ?? 'none'
    const { fadeOpacity, slideX, slideY, blurPx } = computeTransitionState(timeInClip, dur, tIn, tOut, transitionSec)
    applyVideoState(video, scale, cropX, cropY, !!outputFormat, slideX, slideY)
    const cc = clipColorCorrections[clip.id] ?? COLOR_CORRECTION_DEFAULT
    video.style.filter = blurPx > 0 ? `${toCssFilter(cc)} blur(${blurPx.toFixed(1)}px)` : toCssFilter(cc)
    if (transitionOverlayRef.current) transitionOverlayRef.current.style.opacity = String(fadeOpacity)
    syncAudioToTime(t, false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadTime, previewTime, isPlaying, clipKey, clipZooms, clipZoomPresets, clipCrops, clipTransitionDurations, clipTransitionIn, clipTransitionOut, clipColorCorrections, outputFormat, sourcesReady])

  // Reactively apply color filter when corrections change (e.g. while playing or panel open)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const timing = timingsRef.current[activeClipIdxRef.current]
    if (!timing) { video.style.filter = ''; return }
    const cc = clipColorCorrections[timing.clip.id] ?? COLOR_CORRECTION_DEFAULT
    video.style.filter = toCssFilter(cc)
  }, [clipColorCorrections])

  // RAF animation loop — runs during playback to animate zoom presets and transitions smoothly
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animRafRef.current)
      return
    }
    const tick = () => {
      const video = videoRef.current
      const timing = timingsRef.current[activeClipIdxRef.current]
      if (video && timing) {
        const { clip } = timing
        const dur = clip.trimEnd - clip.trimStart

        // Image/background clip: advance via wall-clock
        const src = sourcesRef.current.find(s => s.id === clip.sourceId)
        if (src?.isImage || clip.background) {
          const wallNow = performance.now()
          const elapsed = (wallNow - imageClipWallStartRef.current) / 1000
          const currentTimeline = imageClipPlayheadStartRef.current + elapsed
          if (elapsed >= dur - 0.05) {
            const nextTiming = timingsRef.current[activeClipIdxRef.current + 1]
            if (nextTiming) {
              applyClip(nextTiming.index, nextTiming.clip.trimStart)
              imageClipWallStartRef.current = performance.now()
              imageClipPlayheadStartRef.current = nextTiming.start
              const nextSrc = sourcesRef.current.find(s => s.id === nextTiming.clip.sourceId)
              if (nextSrc?.isImage || nextTiming.clip.background) {
                if (transitionOverlayRef.current) transitionOverlayRef.current.style.opacity = '0'
              } else {
                video.play().catch(() => {})
              }
            } else {
              setPlaying(false)
              setPlayhead(totalDuration)
            }
          } else {
            const now = performance.now()
            if (now - lastSyncRef.current > 33) {
              lastSyncRef.current = now
              setPlayhead(currentTimeline)
              syncAudioToTime(currentTimeline, true)
            }
          }
          animRafRef.current = requestAnimationFrame(tick)
          return
        }

        if (dur > 0) {
          const p = Math.max(0, Math.min(1, (video.currentTime - clip.trimStart) / dur))
          const preset = clipZoomPresetsRef.current[clip.id] ?? 'none'
          const targetZoom = clipZoomsRef.current[clip.id] ?? 1
          const crop = clipCropsRef.current[clip.id] ?? { x: 50, y: 50 }
          const transitionSec = clipTransitionDurationsRef.current[clip.id] ?? 0.5
          const { scale, cropX, cropY } = calcAnimatedState(preset, p, targetZoom, crop, transitionSec, dur)
          const timeInClip = video.currentTime - clip.trimStart
          const tIn  = clipTransitionInRef.current[clip.id]  ?? 'none'
          const tOut = clipTransitionOutRef.current[clip.id] ?? 'none'
          const { fadeOpacity, slideX, slideY, blurPx } = computeTransitionState(timeInClip, dur, tIn, tOut, transitionSec)
          applyVideoState(video, scale, cropX, cropY, !!outputFormatRef.current, slideX, slideY)
          const cc = clipColorCorrectionsRef.current[clip.id] ?? COLOR_CORRECTION_DEFAULT
          video.style.filter = blurPx > 0 ? `${toCssFilter(cc)} blur(${blurPx.toFixed(1)}px)` : toCssFilter(cc)
          if (transitionOverlayRef.current) transitionOverlayRef.current.style.opacity = String(fadeOpacity)
        }
      }
      animRafRef.current = requestAnimationFrame(tick)
    }
    animRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRafRef.current)
  }, [isPlaying, totalDuration]) // eslint-disable-line react-hooks/exhaustive-deps

  // Play / pause
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      const timing = findTiming(playheadTime)
      if (timing) {
        applyClip(timing.index, timing.clip.trimStart + (playheadTime - timing.start))
        const source = timing.clip.background ? null : sourcesRef.current.find(s => s.id === timing.clip.sourceId)
        if (source?.isImage || timing.clip.background) {
          imageClipWallStartRef.current = performance.now()
          imageClipPlayheadStartRef.current = playheadTime
        } else {
          video.play().catch(err => { if (err?.name !== 'AbortError') setPlaying(false) })
        }
      }
      syncAudioToTime(playheadTime, true)
    } else {
      video.pause()
      pauseAllAudio()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Advance through clips during playback
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      if (!isPlaying || !clips.length) return
      const idx = activeClipIdxRef.current
      const timing = timings[idx]
      if (!timing) return
      const { clip } = timing

      // Image clips are driven by the RAF wall-clock loop, not video timeupdate
      const src = sourcesRef.current.find(s => s.id === clip.sourceId)
      if (src?.isImage || clip.background) return

      if (video.currentTime >= clip.trimEnd - 0.05) {
        const next = timings[idx + 1]
        console.log('[onTimeUpdate] clip ended → next:', next?.clip.id, 'nextSrcId:', next?.clip.sourceId)
        if (next) {
          applyClip(next.index, next.clip.trimStart)
          // Apply next clip's initial (progress=0) visual state immediately; RAF will continue from there
          const nextCrop = clipCropsRef.current[next.clip.id] ?? { x: 50, y: 50 }
          const nextPreset = clipZoomPresetsRef.current[next.clip.id] ?? 'none'
          const nextZoom = clipZoomsRef.current[next.clip.id] ?? 1
          const nextDur = next.clip.trimEnd - next.clip.trimStart
          const nextTransition = clipTransitionDurationsRef.current[next.clip.id] ?? 0.5
          const { scale, cropX, cropY } = calcAnimatedState(nextPreset, 0, nextZoom, nextCrop, nextTransition, nextDur)
          applyVideoState(video, scale, cropX, cropY, !!outputFormatRef.current)
          const nextSrc = sourcesRef.current.find(s => s.id === next.clip.sourceId)
          if (nextSrc?.isImage || next.clip.background) {
            imageClipWallStartRef.current = performance.now()
            imageClipPlayheadStartRef.current = next.start
            lastSyncRef.current = performance.now()
            setPlayhead(next.start) // immediately update so isImageClip re-renders to true
          } else {
            video.play()
          }
        } else {
          setPlaying(false)
          setPlayhead(totalDuration)
        }
        return
      }

      const now = performance.now()
      if (now - lastSyncRef.current > 33) {
        lastSyncRef.current = now
        const speed = clipSpeedsRef.current[clip.id] ?? 1
        const currentTimeline = timing.start + (video.currentTime - clip.trimStart) / speed
        setPlayhead(currentTimeline)
        syncAudioToTime(currentTimeline, true)
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, clipKey, totalDuration])

  // Drag-to-pan handlers (direct DOM mutation for smooth dragging, commit to store on mouseup)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeClipId || (currentZoom <= 1 && !outputFormat)) return
    e.preventDefault()
    pushUndo()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      cropX: currentCrop.x,
      cropY: currentCrop.y,
      clipId: activeClipId,
    }
  }, [outputFormat, activeClipId, currentCrop, currentZoom, pushUndo])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const dx = (drag.startX - e.clientX) / rect.width * 100
      const dy = (drag.startY - e.clientY) / rect.height * 100
      const newX = Math.max(0, Math.min(100, drag.cropX + dx))
      const newY = Math.max(0, Math.min(100, drag.cropY + dy))
      // Direct DOM update for smooth dragging
      if (videoRef.current) videoRef.current.style.objectPosition = `${newX}% ${newY}%`
    }

    const handleUp = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const dx = (drag.startX - e.clientX) / rect.width * 100
      const dy = (drag.startY - e.clientY) / rect.height * 100
      const newX = Math.max(0, Math.min(100, drag.cropX + dx))
      const newY = Math.max(0, Math.min(100, drag.cropY + dy))
      setClipCrop(drag.clipId, newX, newY) // commit to store
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [setClipCrop])

  // Overlay drag handlers
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = overlayDragRef.current
      if (!drag) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const newX = Math.max(0, Math.min(100, drag.ox + (e.clientX - drag.startX) / rect.width * 100))
      const newY = Math.max(0, Math.min(100, drag.oy + (e.clientY - drag.startY) / rect.height * 100))
      updateOverlayLayer(drag.id, { x: newX, y: newY })
    }
    const handleUp = () => { overlayDragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [updateOverlayLayer])

  // Shape drag + resize handlers
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = shapeDragRef.current
      if (!drag) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const dxPct = (e.clientX - drag.startX) / rect.width  * 100
      const dyPct = (e.clientY - drag.startY) / rect.height * 100
      if (drag.mode === 'move') {
        updateShapeLayer(drag.id, {
          x: Math.max(0, Math.min(100, drag.ox + dxPct)),
          y: Math.max(0, Math.min(100, drag.oy + dyPct)),
        })
      } else {
        let newX = drag.ox, newW = drag.ow, newY = drag.oy, newH = drag.oh
        if (drag.affectsX) {
          const movingX = drag.movingStartX + dxPct
          newW = Math.max(2, Math.abs(drag.fixedX - movingX))
          newX = (drag.fixedX + movingX) / 2
        }
        if (drag.affectsY) {
          const movingY = drag.movingStartY + dyPct
          newH = Math.max(2, Math.abs(drag.fixedY - movingY))
          newY = (drag.fixedY + movingY) / 2
        }
        updateShapeLayer(drag.id, { x: newX, y: newY, width: newW, height: newH })
      }
    }
    const handleUp = () => { shapeDragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [updateShapeLayer])

  // Hide layer drag + resize handlers
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = hideDragRef.current
      if (!drag) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const dxPct = (e.clientX - drag.startX) / rect.width  * 100
      const dyPct = (e.clientY - drag.startY) / rect.height * 100
      if (drag.mode === 'move') {
        updateHideLayer(drag.id, {
          x: Math.max(0, Math.min(100, drag.ox + dxPct)),
          y: Math.max(0, Math.min(100, drag.oy + dyPct)),
        })
      } else {
        let newX = drag.ox, newW = drag.ow, newY = drag.oy, newH = drag.oh
        if (drag.affectsX) {
          const movingX = drag.movingStartX + dxPct
          newW = Math.max(2, Math.abs(drag.fixedX - movingX))
          newX = (drag.fixedX + movingX) / 2 - newW / 2
        }
        if (drag.affectsY) {
          const movingY = drag.movingStartY + dyPct
          newH = Math.max(2, Math.abs(drag.fixedY - movingY))
          newY = (drag.fixedY + movingY) / 2 - newH / 2
        }
        updateHideLayer(drag.id, { x: Math.max(0, newX), y: Math.max(0, newY), w: newW, h: newH })
      }
    }
    const handleUp = () => { hideDragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [updateHideLayer])

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
        {clips.length > 0 ? (
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            className="relative overflow-hidden bg-black"
            style={{
              aspectRatio: String(previewAspect),
              maxWidth: '100%',
              maxHeight: '100%',
              cursor: 'grab',
            }}
          >
            {/* Background color/gradient clip fill */}
            {activeClipBackground && (
              <div className="absolute inset-0 z-0" style={{ background: activeClipBackground.value }} />
            )}
            <video
              ref={videoRef}
              playsInline
              crossOrigin="anonymous"
              className="w-full h-full"
              style={{
                objectFit: 'cover',
                objectPosition: `${currentCrop.x}% ${currentCrop.y}%`,
                // visibility:hidden keeps the video in layout flow so the container
                // retains its size (needed for background/image clips where there is
                // no other in-flow content to size the aspect-ratio container).
                visibility: (isBackgroundClip || isImageClip) ? 'hidden' : 'visible',
              }}
            />
            {/* Freeze frame / image clip — always mounted (like <video>) so display is instant;
                hidden via display:none when not in an image clip to avoid mount-timing races */}
            <img
              ref={imgRef}
              alt=""
              src={activeSource?.isImage ? (activeSource.objectUrl || undefined) : undefined}
              className="absolute inset-0 w-full h-full"
              style={{
                objectFit: 'cover',
                objectPosition: `${currentCrop.x}% ${currentCrop.y}%`,
                transform: currentZoom !== 1 ? `scale(${currentZoom})` : undefined,
                transformOrigin: `${currentCrop.x}% ${currentCrop.y}%`,
                display: (isImageClip && !!activeSource?.objectUrl) ? '' : 'none',
              }}
            />
            {/* Loading spinner — shown until all sources have a resolved objectUrl */}
            {!sourcesReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-30 pointer-events-none">
                <div className="w-8 h-8 rounded-full border-2 border-neutral-600 border-t-white animate-spin" />
              </div>
            )}
            {/* Transition fade overlay — opacity driven imperatively by seek/RAF */}
            <div
              ref={transitionOverlayRef}
              className="absolute inset-0 bg-black pointer-events-none"
              style={{ opacity: 0 }}
            />
            {/* Subtitle overlay */}
            {activeSegment && subtitleStyle === 'standard' && (
              <div className={subPositionClass(subtitlePosition)}>
                <div
                  className="font-medium px-3 py-1.5 rounded leading-snug"
                  style={{
                    fontSize: `${subtitleFontSize * 0.875}rem`,
                    maxWidth: '70%',
                    wordBreak: 'break-word',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textAlign: (subtitlePosition === 'left' || subtitlePosition === 'right') ? subtitlePosition : 'center',
                    color: standardSubtitleAppearance.textColor,
                    background: standardSubtitleAppearance.bgOpacity > 0
                      ? hexToRgba(standardSubtitleAppearance.bgColor, standardSubtitleAppearance.bgOpacity)
                      : 'transparent',
                  }}
                >
                  {activeSegment.text}
                </div>
              </div>
            )}
            {activeSegment && subtitleStyle === 'highlight' && displayWords.length > 0 && (
              <div className={subPositionClass(subtitlePosition)}>
                <div
                  className="px-4 py-2 rounded-xl flex flex-wrap gap-1.5"
                  style={{
                    maxWidth: '70%',
                    justifyContent: (subtitlePosition === 'left') ? 'flex-start' : (subtitlePosition === 'right') ? 'flex-end' : 'center',
                    alignItems: 'center',
                    ...(subtitleAppearance.bgOpacity > 0
                      ? { background: hexToRgba(subtitleAppearance.bgColor, subtitleAppearance.bgOpacity) }
                      : {}),
                  }}
                >
                  {displayWords.map((w, i) => {
                    const isActive = windowStart + i === currentWordIdx
                    return (
                      <span
                        key={windowStart + i}
                        className="font-bold"
                        style={{
                          fontSize: `${subtitleFontSize}rem`,
                          ...(isActive
                            ? { color: subtitleAppearance.highlightColor }
                            : { color: subtitleAppearance.inactiveColor, opacity: subtitleAppearance.inactiveOpacity }),
                        }}
                      >
                        {w.word}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Shape layers */}
            <div className="absolute inset-0 pointer-events-none">
              {shapeLayers.map(shape => {
                if (t < shape.startAt || t >= shape.startAt + shape.duration) return null
                const isSel = selectedShapeId === shape.id
                return (
                  <div
                    key={shape.id}
                    className="absolute pointer-events-auto"
                    style={{
                      left: `${shape.x}%`,
                      top: `${shape.y}%`,
                      width: `${shape.width}%`,
                      height: `${shape.height}%`,
                      transform: 'translate(-50%, -50%)',
                      opacity: shape.opacity,
                      outline: isSel ? '2px solid #60a5fa' : 'none',
                      outlineOffset: '2px',
                      cursor: 'move',
                    }}
                    onClick={e => { e.stopPropagation(); setSelectedShapeId(shape.id) }}
                    onMouseDown={e => {
                      e.stopPropagation()
                      setSelectedShapeId(shape.id)
                      shapeDragRef.current = { id: shape.id, mode: 'move', startX: e.clientX, startY: e.clientY, ox: shape.x, oy: shape.y }
                    }}
                  >
                    {shape.type === 'ripple' ? <RippleStroke shape={shape} /> : <ShapeStroke shape={shape} />}

                    {isSel && RESIZE_HANDLES.map(([relX, relY, cursor]) => (
                      <div
                        key={`${relX}-${relY}`}
                        className="absolute z-10"
                        style={{
                          width: 8, height: 8,
                          left: `${relX * 100}%`, top: `${relY * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          cursor,
                          background: 'white',
                          border: '1.5px solid #3b82f6',
                          borderRadius: 1,
                        }}
                        onMouseDown={e => {
                          e.stopPropagation()
                          const affectsX = relX !== 0.5
                          const affectsY = relY !== 0.5
                          shapeDragRef.current = {
                            id: shape.id, mode: 'resize',
                            startX: e.clientX, startY: e.clientY,
                            ox: shape.x, oy: shape.y, ow: shape.width, oh: shape.height,
                            fixedX: shape.x + shape.width  * (0.5 - relX),
                            fixedY: shape.y + shape.height * (0.5 - relY),
                            movingStartX: shape.x + shape.width  * (relX - 0.5),
                            movingStartY: shape.y + shape.height * (relY - 0.5),
                            affectsX, affectsY,
                          }
                        }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Hide layers */}
            <div className="absolute inset-0 pointer-events-none">
              {hideLayers.map(hl => {
                if (t < hl.startAt || t >= hl.startAt + hl.duration) return null
                const isSel = selectedHideLayerId === hl.id
                return (
                  <div
                    key={hl.id}
                    className="absolute pointer-events-auto"
                    style={{
                      left: `${hl.x}%`,
                      top: `${hl.y}%`,
                      width: `${hl.w}%`,
                      height: `${hl.h}%`,
                      cursor: 'move',
                      outline: isSel ? '2px solid #60a5fa' : 'none',
                      outlineOffset: '2px',
                      ...(hl.style === 'black'
                        ? { background: '#000' }
                        : { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(255,255,255,0.08)' }),
                    }}
                    onClick={e => { e.stopPropagation(); setSelectedHideLayerId(hl.id) }}
                    onMouseDown={e => {
                      e.stopPropagation()
                      setSelectedHideLayerId(hl.id)
                      hideDragRef.current = { id: hl.id, mode: 'move', startX: e.clientX, startY: e.clientY, ox: hl.x, oy: hl.y }
                    }}
                  >
                    {isSel && RESIZE_HANDLES.map(([relX, relY, cursor]) => (
                      <div
                        key={`${relX}-${relY}`}
                        className="absolute z-10"
                        style={{
                          width: 8, height: 8,
                          left: `${relX * 100}%`, top: `${relY * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          cursor,
                          background: 'white',
                          border: '1.5px solid #3b82f6',
                          borderRadius: 1,
                        }}
                        onMouseDown={e => {
                          e.stopPropagation()
                          const affectsX = relX !== 0.5
                          const affectsY = relY !== 0.5
                          // fixedX/Y: the opposite edge (top-left based coords)
                          // movingStartX/Y: the edge being dragged
                          hideDragRef.current = {
                            id: hl.id, mode: 'resize',
                            startX: e.clientX, startY: e.clientY,
                            ox: hl.x, oy: hl.y, ow: hl.w, oh: hl.h,
                            fixedX: hl.x + hl.w * (1 - relX),
                            fixedY: hl.y + hl.h * (1 - relY),
                            movingStartX: hl.x + hl.w * relX,
                            movingStartY: hl.y + hl.h * relY,
                            affectsX, affectsY,
                          }
                        }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Overlay layers — absolute inset-0 wrapper gives a reliable full-size
                positioning context regardless of the parent's flex layout */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {overlayLayers.map(ol => {
                const t = previewTime ?? playheadTime
                if (t < ol.startAt || t >= ol.startAt + ol.duration) return null
                const isSel = selectedOverlayId === ol.id
                const commonStyle: React.CSSProperties = {
                  position: 'absolute',
                  left: `${ol.x}%`,
                  top: `${ol.y}%`,
                  transform: 'translate(-50%, -50%)',
                  opacity: ol.opacity,
                  outline: isSel ? '2px solid #3b82f6' : '2px solid transparent',
                  outlineOffset: 2,
                  cursor: isSel ? 'move' : 'pointer',
                  userSelect: 'none',
                  pointerEvents: 'auto',
                }
                if (ol.type === 'image' && ol.objectUrl) {
                  return (
                    <img
                      key={ol.id}
                      src={ol.objectUrl}
                      style={{ ...commonStyle, width: `${ol.width}%` }}
                      draggable={false}
                      onClick={e => { e.stopPropagation(); setSelectedOverlayId(ol.id) }}
                      onMouseDown={e => {
                        if (!isSel) return
                        e.stopPropagation()
                        pushUndo()
                        overlayDragRef.current = { startX: e.clientX, startY: e.clientY, ox: ol.x, oy: ol.y, id: ol.id }
                      }}
                    />
                  )
                }
                if (ol.type === 'text') {
                  const container = containerRef.current
                  const h = container?.clientHeight ?? 400
                  // Support both plain text (legacy \n) and rich HTML from the editor
                  const rawText = ol.text || 'Text'
                  const html = rawText.includes('<')
                    ? rawText
                    : rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
                  return (
                    <div
                      key={ol.id}
                      style={{
                        ...commonStyle,
                        fontSize: `${h * (ol.fontSize ?? 5) / 100}px`,
                        fontWeight: ol.fontWeight ?? 'normal',
                        color: ol.color ?? '#ffffff',
                        backgroundColor: (ol.bgOpacity ?? 0) > 0
                          ? `${ol.bgColor ?? '#000000'}${Math.round((ol.bgOpacity ?? 0) * 255).toString(16).padStart(2, '0')}`
                          : 'transparent',
                        padding: (ol.bgOpacity ?? 0) > 0 || (ol.borderWidth ?? 0) > 0 ? '2px 8px' : undefined,
                        borderRadius: ol.borderRadius ?? ((ol.bgOpacity ?? 0) > 0 ? 4 : 0),
                        border: (ol.borderWidth ?? 0) > 0 ? `${ol.borderWidth}px solid ${ol.borderColor ?? '#ffffff'}` : undefined,
                        lineHeight: 1.35,
                      }}
                      dangerouslySetInnerHTML={{ __html: html }}
                      onClick={e => { e.stopPropagation(); setSelectedOverlayId(ol.id) }}
                      onMouseDown={e => {
                        if (!isSel) return
                        e.stopPropagation()
                        pushUndo()
                        overlayDragRef.current = { startX: e.clientX, startY: e.clientY, ox: ol.x, oy: ol.y, id: ol.id }
                      }}
                    />
                  )
                }
                return null
              })}
            </div>

            {/* Format label + drag hint */}
            {(outputFormat || currentZoom > 1) && (
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded px-2 py-1 pointer-events-none">
                {outputFormat && <span className="text-[10px] text-white/60 font-medium">{outputFormat.aspectW}:{outputFormat.aspectH}</span>}
                {currentZoom > 1 && <span className="text-[10px] text-white/60 font-medium">{currentZoom}×</span>}
                <span className="text-[10px] text-white/40">· drag to reposition</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-neutral-600 text-sm">Upload a video to get started</p>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4 py-3 border-t border-neutral-800 shrink-0 relative">
        <button
          onClick={() => setPlaying(!isPlaying)}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-9 h-9 rounded-full bg-neutral-700 hover:bg-neutral-600 flex items-center justify-center transition-colors"
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>
        <span className="text-xs font-mono text-neutral-400 tabular-nums">
          {formatTime(previewTime ?? playheadTime)} / {formatTime(totalDuration)}
        </span>

        {/* CC selector — shown only when CC segments exist */}
        {hasCc && (
          <div className="absolute right-3">
            <CCSelector />
          </div>
        )}
      </div>
    </div>
  )
}
