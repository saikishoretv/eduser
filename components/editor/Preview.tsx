'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '@/store/store'
import { ZoomPreset, TransitionType } from '@/store/store'
import { getClipTimings, formatTime } from '@/lib/clipUtils'
import { ClipTiming } from '@/lib/clipUtils'
import { hexToRgba } from '@/lib/subtitleTemplates'
import { toCssFilter, COLOR_CORRECTION_DEFAULT } from '@/lib/colorPresets'
import CCSelector from './CCSelector'

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

export default function Preview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const transitionOverlayRef = useRef<HTMLDivElement>(null)
  const activeClipIdxRef = useRef<number>(0)
  const lastSyncRef = useRef<number>(0)
  const animRafRef = useRef<number>(0)
  const dragRef = useRef<{ startX: number; startY: number; cropX: number; cropY: number; clipId: string } | null>(null)
  const overlayDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; id: string } | null>(null)

  const clips       = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? EMPTY_CLIPS)
  const sources     = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.sources ?? EMPTY_SOURCES)
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
  const subtitleStyle = useEditorStore(s => s.subtitleStyle)
  const subtitleAppearance = useEditorStore(s => s.subtitleAppearance)
  const standardSubtitleAppearance = useEditorStore(s => s.standardSubtitleAppearance)
  const setPlayhead = useEditorStore(s => s.setPlayhead)
  const setPlaying = useEditorStore(s => s.setPlaying)
  const setClipCrop = useEditorStore(s => s.setClipCrop)
  const pushUndo    = useEditorStore(s => s.pushUndo)

  const timings = getClipTimings(clips)
  const totalDuration = timings.length > 0 ? timings[timings.length - 1].end : 0
  const clipKey = clips.map(c => `${c.id}:${c.trimStart}:${c.trimEnd}`).join('|')

  // Which clip the playhead is currently in
  const activeTiming: ClipTiming | null =
    timings.find(t => (previewTime ?? playheadTime) >= t.start && (previewTime ?? playheadTime) < t.end) ??
    timings[timings.length - 1] ??
    null
  const activeClipId = activeTiming?.clip.id ?? null
  const currentCrop = activeClipId ? (clipCrops[activeClipId] ?? { x: 50, y: 50 }) : { x: 50, y: 50 }

  // Subtitles: map current timeline time → source time → active transcript segment
  const activeSource = activeTiming
    ? sources.find(s => s.id === activeTiming.clip.sourceId)
    : null
  const currentSourceTime = activeTiming
    ? activeTiming.clip.trimStart + ((previewTime ?? playheadTime) - activeTiming.start)
    : 0
  const activeSegment = activeSource?.transcript?.find(
    seg => currentSourceTime >= seg.start && currentSourceTime < seg.end
  ) ?? null
  const hasTranscript = !!activeSource?.transcript?.length

  // For highlight mode: find current word and build a 4-word display window
  const words = activeSegment?.words ?? []
  const currentWordIdx = words.findIndex(w => currentSourceTime >= w.start && currentSourceTime < w.end)
  const anchorIdx = currentWordIdx >= 0
    ? currentWordIdx
    : words.findLastIndex(w => w.start <= currentSourceTime)
  const windowStart = Math.max(0, anchorIdx - 1)
  const windowEnd = Math.min(words.length, windowStart + 4)
  const displayWords = words.slice(windowStart, windowEnd)

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
  const outputFormatRef = useRef(outputFormat)
  const timingsRef = useRef(timings)
  clipCropsRef.current = clipCrops
  clipZoomsRef.current = clipZooms
  clipZoomPresetsRef.current = clipZoomPresets
  clipTransitionDurationsRef.current = clipTransitionDurations
  clipTransitionInRef.current  = clipTransitionIn
  clipTransitionOutRef.current = clipTransitionOut
  clipColorCorrectionsRef.current = clipColorCorrections
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

  function syncAudioToTime(t: number, play: boolean) {
    for (const layer of audioLayersRef.current) {
      const el = audioElementsRef.current.get(layer.id)
      if (!el || !el.src) continue
      const offset   = t - layer.startAt
      const layerEnd = layer.startAt + (layer.trimEnd - layer.trimStart)
      const inRange  = offset >= 0 && t < layerEnd
      if (inRange) {
        const sourceTime = layer.trimStart + offset
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
    const timing = timings[clipIdx]
    if (!timing) return
    const source = sources.find(s => s.id === timing.clip.sourceId)
    if (!source) return
    activeClipIdxRef.current = clipIdx
    if (video.src !== source.objectUrl) video.src = source.objectUrl
    video.currentTime = seekTo
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
  }, [playheadTime, previewTime, isPlaying, clipKey, clipZooms, clipZoomPresets, clipCrops, clipTransitionDurations, clipTransitionIn, clipTransitionOut, clipColorCorrections, outputFormat])

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
  }, [isPlaying])

  // Play / pause
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      const timing = findTiming(playheadTime)
      if (timing) applyClip(timing.index, timing.clip.trimStart + (playheadTime - timing.start))
      video.play().catch(() => setPlaying(false))
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

      if (video.currentTime >= clip.trimEnd - 0.05) {
        const next = timings[idx + 1]
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
          video.play()
        } else {
          setPlaying(false)
          setPlayhead(totalDuration)
        }
        return
      }

      const now = performance.now()
      if (now - lastSyncRef.current > 33) {
        lastSyncRef.current = now
        const currentTimeline = timing.start + (video.currentTime - clip.trimStart)
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
    if (!outputFormat || !activeClipId) return
    e.preventDefault()
    pushUndo()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      cropX: currentCrop.x,
      cropY: currentCrop.y,
      clipId: activeClipId,
    }
  }, [outputFormat, activeClipId, currentCrop, pushUndo])

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

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
        {clips.length > 0 ? (
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            className="relative overflow-hidden bg-black"
            style={outputFormat
              ? {
                  aspectRatio: `${outputFormat.aspectW}/${outputFormat.aspectH}`,
                  maxHeight: '100%',
                  maxWidth: '100%',
                  cursor: 'grab',
                }
              : { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }
            }
          >
            <video
              ref={videoRef}
              playsInline
              className={outputFormat ? 'w-full h-full' : 'max-h-full max-w-full'}
              style={outputFormat
                ? { objectFit: 'cover', objectPosition: `${currentCrop.x}% ${currentCrop.y}%` }
                : undefined
              }
            />
            {/* Transition fade overlay — opacity driven imperatively by seek/RAF */}
            <div
              ref={transitionOverlayRef}
              className="absolute inset-0 bg-black pointer-events-none"
              style={{ opacity: 0 }}
            />
            {/* Subtitle overlay */}
            {activeSegment && subtitleStyle === 'standard' && (
              <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-4">
                <div
                  className="text-sm font-medium px-3 py-1.5 rounded max-w-full text-center leading-snug"
                  style={{
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
              <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-4">
                <div
                  className="px-4 py-2 rounded-xl flex items-center gap-1.5 flex-wrap justify-center"
                  style={subtitleAppearance.bgOpacity > 0
                    ? { background: hexToRgba(subtitleAppearance.bgColor, subtitleAppearance.bgOpacity) }
                    : undefined
                  }
                >
                  {displayWords.map((w, i) => {
                    const isActive = windowStart + i === currentWordIdx
                    return (
                      <span
                        key={windowStart + i}
                        className="text-base font-bold"
                        style={isActive
                          ? { color: subtitleAppearance.highlightColor }
                          : { color: subtitleAppearance.inactiveColor, opacity: subtitleAppearance.inactiveOpacity }
                        }
                      >
                        {w.word}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
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
            {outputFormat && (
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded px-2 py-1 pointer-events-none">
                <span className="text-[10px] text-white/60 font-medium">{outputFormat.aspectW}:{outputFormat.aspectH}</span>
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

        {/* CC selector — shown only when transcript exists */}
        {hasTranscript && (
          <div className="absolute right-3">
            <CCSelector />
          </div>
        )}
      </div>
    </div>
  )
}
