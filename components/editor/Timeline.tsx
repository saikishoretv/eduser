'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { getClipTimings, formatTime } from '@/lib/clipUtils'
import { AudioLayer, Step } from '@/types'
import TimeRuler from './TimeRuler'
import ClipItem from './ClipItem'
import AudioLayerItem from './AudioLayerItem'
import OverlayItem from './OverlayItem'
import BackgroundClipPicker from './BackgroundClipPicker'
import ClipReorderOverlay from './ClipReorderOverlay'

const MIN_DURATION = 10
const EMPTY_CLIPS: import('@/types').Clip[] = []
const EMPTY_AUDIO_LAYERS: AudioLayer[] = []
const EMPTY_OVERLAY_LAYERS: import('@/types').OverlayLayer[] = []
const EMPTY_STEPS: Step[] = []

// Must match COLORS in ClipItem and STEP_ACCENTS in AudioLayerItem
const STEP_BG_COLORS = [
  'rgba(37,99,235,0.07)',
  'rgba(124,58,237,0.07)',
  'rgba(5,150,105,0.07)',
  'rgba(217,119,6,0.07)',
  'rgba(225,29,72,0.07)',
  'rgba(8,145,178,0.07)',
]

function stepColorIdxForTime(t: number, sortedPositions: number[]): number | undefined {
  if (!sortedPositions.length) return undefined
  let idx = -1
  for (let i = 0; i < sortedPositions.length; i++) {
    if (sortedPositions[i] <= t + 0.001) idx = i
    else break
  }
  return idx >= 0 ? idx : undefined
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.onloadedmetadata = () => resolve(audio.duration)
    audio.onerror = () => reject(new Error('Could not read audio duration'))
    audio.src = url
  })
}

export default function Timeline() {
  const scrollRef      = useRef<HTMLDivElement>(null)
  const stepsRowRef    = useRef<HTMLDivElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const imgInputRef    = useRef<HTMLInputElement>(null)
  const videoInputRef  = useRef<HTMLInputElement>(null)
  const [hoverX, setHoverX]             = useState<number | null>(null)
  const [hoverTime, setHoverTime]       = useState<number | null>(null)
  const [hoverStepsX, setHoverStepsX]   = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [addingImg, setAddingImg] = useState(false)
  const [addingClip, setAddingClip] = useState(false)
  const [showBgPicker, setShowBgPicker] = useState(false)

  const activeProjectId = useEditorStore(s => s.activeProjectId)
  const clips         = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? EMPTY_CLIPS)
  const audioLayers   = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.audioLayers ?? EMPTY_AUDIO_LAYERS)
  const overlayLayers = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.overlayLayers ?? EMPTY_OVERLAY_LAYERS)
  const steps         = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.steps ?? EMPTY_STEPS)
  const updateStep    = useEditorStore(s => s.updateStep)
  const moveStep      = useEditorStore(s => s.moveStep)
  const addStep       = useEditorStore(s => s.addStep)
  const selectedAudioLayerId = useEditorStore(s => s.selectedAudioLayerId)
  const selectedOverlayId    = useEditorStore(s => s.selectedOverlayId)
  const playheadTime  = useEditorStore(s => s.playheadTime)

  const selectedClipIds = useEditorStore(s => s.selectedClipIds)
  const zoom            = useEditorStore(s => s.zoom)

  const setPlayhead   = useEditorStore(s => s.setPlayhead)
  const setPreviewTime = useEditorStore(s => s.setPreviewTime)
  const clearSelection = useEditorStore(s => s.clearSelection)
  const setSelectedAudioLayerId = useEditorStore(s => s.setSelectedAudioLayerId)
  const setSelectedOverlayId    = useEditorStore(s => s.setSelectedOverlayId)
  const addAudioLayer        = useEditorStore(s => s.addAudioLayer)
  const addOverlayLayer      = useEditorStore(s => s.addOverlayLayer)
  const addSourceToProject   = useEditorStore(s => s.addSourceToProject)
  const addBackgroundClip    = useEditorStore(s => s.addBackgroundClip)
  const reorderClips         = useEditorStore(s => s.reorderClips)
  const setZoom         = useEditorStore(s => s.setZoom)
  const clipSpeeds      = useEditorStore(s => s.clipSpeeds)

  // Restore zoom from localStorage or auto-fit to 90% of container width (once per project)
  const zoomFitProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (zoomFitProjectRef.current === activeProjectId) return
    if (!scrollRef.current || !activeProjectId) return
    const width = scrollRef.current.clientWidth
    if (width === 0) return
    zoomFitProjectRef.current = activeProjectId
    const saved = localStorage.getItem(`clipr-zoom-${activeProjectId}`)
    if (saved !== null) {
      setZoom(parseFloat(saved))
    } else {
      const timings = getClipTimings(clips, clipSpeeds)
      const duration = timings.length > 0 ? timings[timings.length - 1].end : MIN_DURATION
      setZoom((width * 0.9) / duration)
    }
  }, [activeProjectId, clips, clipSpeeds, setZoom])

  // Persist zoom to localStorage whenever it changes (skip before project is initialized)
  useEffect(() => {
    if (zoomFitProjectRef.current !== activeProjectId || !activeProjectId) return
    localStorage.setItem(`clipr-zoom-${activeProjectId}`, String(zoom))
  }, [zoom, activeProjectId])

  // Clip reorder overlay
  const [reorderOverlay, setReorderOverlay] = useState<{
    clipId: string; mouseX: number; mouseY: number
  } | null>(null)
  const clipDragRef = useRef<{ clipId: string; startX: number } | null>(null)

  // Step marker drag — track in local state to avoid store churn during drag
  const [markerDrag, setMarkerDrag] = useState<{ stepId: string; x: number } | null>(null)
  const markerDragRef = useRef<{ stepId: string; startClientX: number; startPos: number } | null>(null)

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = markerDragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startClientX
      const newPos = Math.max(0, drag.startPos + dx / zoom)
      setMarkerDrag({ stepId: drag.stepId, x: newPos * zoom })
    }
    const handleUp = (e: MouseEvent) => {
      const drag = markerDragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startClientX
      const newPos = Math.max(0, drag.startPos + dx / zoom)
      if (activeProjectId) moveStep(activeProjectId, drag.stepId, newPos)
      markerDragRef.current = null
      setMarkerDrag(null)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [zoom, activeProjectId, moveStep])

  const timings = getClipTimings(clips, clipSpeeds)

  // Sorted step positions — used for background strips and per-item coloring
  const sortedStepPositions = steps
    .map(s => s.timelinePosition ?? timings.find(t => t.clip.id === s.clipId)?.start ?? 0)
    .sort((a, b) => a - b)

  const clipsDuration   = timings.length > 0 ? timings[timings.length - 1].end : 0
  const audioDuration   = audioLayers.reduce((max, l) => Math.max(max, l.startAt + (l.trimEnd - l.trimStart)), 0)
  const overlayDuration = overlayLayers.reduce((max, ol) => Math.max(max, ol.startAt + ol.duration), 0)
  const totalDuration   = Math.max(clipsDuration, audioDuration, overlayDuration, MIN_DURATION)
  const contentWidth  = totalDuration * zoom + 200
  const playheadX     = playheadTime * zoom

  // Track row positions
  const RULER_H       = 36
  const STEPS_H       = steps.length > 0 ? 22 : 0   // step marker row, only when project has steps
  const CLIPS_TOP     = RULER_H + STEPS_H
  const CLIPS_H       = 52
  const AUDIO_START   = CLIPS_TOP + CLIPS_H + 8
  const AUDIO_ROW_H   = 36
  const AUDIO_ROW_GAP = 4

  const numAudioRows    = Math.max(1, audioLayers.length)
  const OVERLAY_ROW_H   = 32
  const OVERLAY_ROW_GAP = 4
  const OVERLAY_START   = AUDIO_START + numAudioRows * (AUDIO_ROW_H + AUDIO_ROW_GAP) + 8
  const numOverlayRows  = Math.max(1, overlayLayers.length)
  const scrollAreaH     = OVERLAY_START + numOverlayRows * (OVERLAY_ROW_H + OVERLAY_ROW_GAP) + 8
  const HEADER_H        = 36
  const timelineH       = HEADER_H + scrollAreaH

  const getLayerTop   = (i: number) => AUDIO_START   + i * (AUDIO_ROW_H   + AUDIO_ROW_GAP)
  const getOverlayTop = (i: number) => OVERLAY_START + i * (OVERLAY_ROW_H + OVERLAY_ROW_GAP)

  const getXAndTime = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = scrollRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft
      const time = Math.max(0, Math.min(x / zoom, totalDuration))
      return { x, time }
    },
    [zoom, totalDuration]
  )

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Let the steps row handle its own clicks (adding a step)
      if (stepsRowRef.current?.contains(e.target as Node)) return
      const result = getXAndTime(e)
      if (result) setPlayhead(result.time)
    },
    [getXAndTime, setPlayhead]
  )

  const handleClick = useCallback(() => {
    clearSelection()
    setSelectedAudioLayerId(null)
  }, [clearSelection, setSelectedAudioLayerId])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (useEditorStore.getState().isPlaying) return
      const result = getXAndTime(e)
      if (!result) return
      setHoverX(result.x)
      setHoverTime(result.time)
      setPreviewTime(result.time)
    },
    [getXAndTime, setPreviewTime]
  )

  const handleMouseLeave = useCallback(() => {
    setHoverX(null)
    setHoverTime(null)
    setPreviewTime(null)
  }, [setPreviewTime])

  async function handleAudioFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const objectUrl = URL.createObjectURL(file)
      const duration  = await getAudioDuration(objectUrl)
      const layer: AudioLayer = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        objectUrl,
        duration,
        volume: 0.8,
        startAt: 0,
        trimStart: 0,
        trimEnd: duration,
      }
      addAudioLayer(layer)
    } finally {
      setUploading(false)
    }
  }

  async function handleVideoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAddingClip(true)
    try {
      const objectUrl = URL.createObjectURL(file)
      const { duration, width, height } = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
        v.onerror = reject
        v.src = objectUrl
      })
      const sourceId = crypto.randomUUID()

      // Upload to S3
      const urlRes = await fetch('/api/sources/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, fileName: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = await urlRes.json()

      const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!uploadRes.ok) throw new Error('S3 upload failed')

      addSourceToProject({
        id: sourceId,
        name: file.name.replace(/\.[^.]+$/, ''),
        duration,
        width,
        height,
        objectUrl,
        s3Key,
      })
    } catch (err) {
      console.error('Failed to add clip:', err)
    } finally {
      setAddingClip(false)
    }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAddingImg(true)
    try {
      const objectUrl = URL.createObjectURL(file)
      const layer = {
        id: crypto.randomUUID(),
        type: 'image' as const,
        startAt: playheadTime,
        duration: 5,
        x: 50,
        y: 50,
        opacity: 1,
        objectUrl,
        fileName: file.name,
        width: 30,
      }
      addOverlayLayer(layer)
    } finally {
      setAddingImg(false)
    }
  }

  function handleAddText() {
    const layer = {
      id: crypto.randomUUID(),
      type: 'text' as const,
      startAt: playheadTime,
      duration: 5,
      x: 50,
      y: 50,
      opacity: 1,
      text: 'Text',
      fontSize: 5,
      fontWeight: 'normal' as const,
      color: '#ffffff',
      bgColor: '#000000',
      bgOpacity: 0,
      width: 0,
    }
    addOverlayLayer(layer)
  }

  return (
    <div className="relative flex flex-col bg-neutral-900 border-t border-neutral-700" style={{ height: timelineH }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-500 font-medium">Timeline</span>
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={addingClip}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-40"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {addingClip ? 'Uploading…' : 'Add clip'}
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleVideoFileChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-40"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {uploading ? 'Adding…' : 'Add audio'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleAudioFileChange}
          />

          <button
            onClick={() => imgInputRef.current?.click()}
            disabled={addingImg}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-40"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {addingImg ? 'Adding…' : 'Add image'}
          </button>
          <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />

          <button
            onClick={handleAddText}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add text
          </button>

          <div className="relative">
            <button
              onClick={() => setShowBgPicker(v => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Background
            </button>
            {showBgPicker && (
              <BackgroundClipPicker
                onSelect={bg => { addBackgroundClip(bg); setShowBgPicker(false) }}
                onClose={() => setShowBgPicker(false)}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const w = scrollRef.current?.clientWidth ?? 800
              setZoom(Math.max(20, (w - 40) / totalDuration))
            }}
            className="text-[11px] text-neutral-400 hover:text-white px-2 py-1 rounded hover:bg-neutral-700 transition-colors"
          >
            Fit All
          </button>
          <button
            onClick={() => {
              const selected = timings.filter(t => selectedClipIds.includes(t.clip.id))
              if (!selected.length) return
              const dur = selected.reduce((s, t) => s + t.duration, 0)
              const w = scrollRef.current?.clientWidth ?? 800
              setZoom(Math.max(20, (w - 40) / dur))
            }}
            disabled={selectedClipIds.length === 0}
            className="text-[11px] text-neutral-400 hover:text-white px-2 py-1 rounded hover:bg-neutral-700 transition-colors disabled:text-neutral-700 disabled:cursor-not-allowed"
          >
            Fit Clip
          </button>
          <div className="w-px h-3 bg-neutral-700" />
          <button
            onClick={() => setZoom(zoom / 1.5)}
            aria-label="Zoom out"
            className="w-6 h-6 flex items-center justify-center rounded text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors text-base leading-none"
          >
            −
          </button>
          <input
            type="number"
            min={20}
            max={500}
            value={Math.round(zoom)}
            onChange={e => setZoom(Number(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            aria-label="Zoom level in pixels per second"
            className="w-14 text-center text-[11px] text-neutral-300 bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 tabular-nums focus:outline-none focus:border-neutral-500"
          />
          <span className="text-[11px] text-neutral-600">px/s</span>
          <button
            onClick={() => setZoom(zoom * 1.5)}
            aria-label="Zoom in"
            className="w-6 h-6 flex items-center justify-center rounded text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors text-base leading-none"
          >
            +
          </button>
        </div>
      </div>

      {/* Scrollable tracks */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative cursor-crosshair select-none"
        onClickCapture={handleClickCapture}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="relative" style={{ width: contentWidth, height: scrollAreaH }}>
          <TimeRuler totalDuration={totalDuration} zoom={zoom} />

          {/* Step region background strips — span clips + audio + overlay rows */}
          {sortedStepPositions.map((pos, i) => {
            const nextPos = sortedStepPositions[i + 1] ?? totalDuration
            return (
              <div
                key={`step-bg-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: pos * zoom,
                  width: Math.max((nextPos - pos) * zoom, 0),
                  top: CLIPS_TOP,
                  height: scrollAreaH - CLIPS_TOP,
                  background: STEP_BG_COLORS[i % STEP_BG_COLORS.length],
                }}
              />
            )
          })}

          {/* Step markers row */}
          {steps.length > 0 && (
            <div
              ref={stepsRowRef}
              className="absolute left-0 right-0 select-none"
              style={{ top: RULER_H, height: STEPS_H, background: 'rgba(255,255,255,0.015)', cursor: 'cell' }}
              onMouseMove={e => {
                const el = scrollRef.current
                if (!el) return
                const rect = el.getBoundingClientRect()
                setHoverStepsX(e.clientX - rect.left + el.scrollLeft)
              }}
              onMouseLeave={() => setHoverStepsX(null)}
              onClick={e => {
                e.stopPropagation()
                if (!activeProjectId) return
                const el = scrollRef.current
                if (!el) return
                const rect = el.getBoundingClientRect()
                const x = e.clientX - rect.left + el.scrollLeft
                const t = Math.max(0, Math.min(x / zoom, totalDuration))
                const timing = timings.find(tt => t >= tt.start && t < tt.end) ?? timings[timings.length - 1]
                if (!timing) return
                addStep(activeProjectId, {
                  id: crypto.randomUUID(),
                  clipId: timing.clip.id,
                  sourceId: timing.clip.sourceId,
                  title: '',
                  description: '',
                  timelinePosition: t,
                })
              }}
            >
              <span className="absolute left-1 top-0 bottom-0 flex items-center gap-1.5 text-[9px] text-neutral-600 uppercase tracking-wider pointer-events-none">
                Steps
                {steps.length >= 20 && <span className="normal-case tracking-normal text-amber-600">max reached</span>}
              </span>

              {/* Ghost "Add Step" indicator on hover */}
              {hoverStepsX !== null && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: hoverStepsX }}
                >
                  <div className="absolute top-0 bottom-0 w-px bg-amber-300/50" />
                  <div className="absolute top-0 left-1.5 bottom-0 flex items-center">
                    <span className="text-[9px] text-amber-300 bg-neutral-800/90 px-1 py-0.5 rounded whitespace-nowrap">
                      + Add Step
                    </span>
                  </div>
                </div>
              )}

              {/* Existing step markers */}
              {steps.map((step, i) => {
                const basePos = step.timelinePosition ?? timings.find(t => t.clip.id === step.clipId)?.start ?? 0
                const markerX = markerDrag?.stepId === step.id ? markerDrag.x : basePos * zoom

                return (
                  <div
                    key={step.id}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{ left: markerX }}
                  >
                    {/* Vertical guide line extending down through clips row */}
                    <div
                      className="absolute w-px bg-amber-400/25"
                      style={{ top: 0, height: STEPS_H + CLIPS_H }}
                    />
                    {/* Draggable pin */}
                    <div
                      className="absolute top-0 flex items-stretch cursor-ew-resize pointer-events-auto"
                      style={{ height: STEPS_H }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        markerDragRef.current = { stepId: step.id, startClientX: e.clientX, startPos: basePos }
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="w-px h-full bg-amber-400" />
                      <div className="pl-1 flex items-center">
                        <span className="text-[9px] text-amber-400 whitespace-nowrap font-medium bg-neutral-900/80 px-0.5 rounded leading-tight">
                          {step.title || `Step ${i + 1}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Track labels */}
          <div className="absolute left-0 pointer-events-none" style={{ top: CLIPS_TOP, height: CLIPS_H, width: 40 }}>
            <div className="flex items-center h-full px-1">
              <span className="text-[9px] text-neutral-600 uppercase tracking-wider">Video</span>
            </div>
          </div>
          {audioLayers.length === 0 ? (
            <div className="absolute left-0 pointer-events-none" style={{ top: AUDIO_START, height: AUDIO_ROW_H, width: 40 }}>
              <div className="flex items-center h-full px-1">
                <span className="text-[9px] text-neutral-600 uppercase tracking-wider">Audio</span>
              </div>
            </div>
          ) : audioLayers.map((layer, i) => (
            <div key={layer.id} className="absolute left-0 pointer-events-none" style={{ top: getLayerTop(i), height: AUDIO_ROW_H, width: 40 }}>
              <div className="flex items-center h-full px-1">
                <span className="text-[9px] text-neutral-600 uppercase tracking-wider">A{i + 1}</span>
              </div>
            </div>
          ))}

          {/* Clips row */}
          <div className="absolute left-0 right-0" style={{ top: CLIPS_TOP, height: CLIPS_H }}>
            {timings.map(timing => (
              <ClipItem
                key={timing.clip.id}
                timing={timing}
                zoom={zoom}
                stepColorIdx={stepColorIdxForTime(timing.start, sortedStepPositions)}
                onBodyMouseDown={e => {
                  e.stopPropagation()
                  clipDragRef.current = { clipId: timing.clip.id, startX: e.clientX }
                  const move = (ev: MouseEvent) => {
                    if (!clipDragRef.current) return
                    if (Math.abs(ev.clientX - clipDragRef.current.startX) > 5) {
                      const id = clipDragRef.current.clipId
                      clipDragRef.current = null
                      window.removeEventListener('mousemove', move)
                      window.removeEventListener('mouseup', up)
                      setReorderOverlay({ clipId: id, mouseX: ev.clientX, mouseY: ev.clientY })
                    }
                  }
                  const up = () => {
                    clipDragRef.current = null
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              />
            ))}
          </div>

          {/* Audio layer rows — one row per layer */}
          {audioLayers.length === 0 ? (
            <div
              className="absolute left-0 right-0 rounded"
              style={{ top: AUDIO_START, height: AUDIO_ROW_H, background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="flex items-center h-full px-2">
                <span className="text-[10px] text-neutral-700">No audio layers · click "+ Add audio" to add</span>
              </div>
            </div>
          ) : audioLayers.map((layer, i) => (
            <div
              key={layer.id}
              className="absolute left-0 right-0 rounded"
              style={{ top: getLayerTop(i), height: AUDIO_ROW_H, background: 'rgba(255,255,255,0.02)' }}
              onClick={e => { e.stopPropagation(); setSelectedAudioLayerId(layer.id) }}
            >
              <AudioLayerItem
                layer={layer}
                zoom={zoom}
                selected={selectedAudioLayerId === layer.id}
                stepColorIdx={stepColorIdxForTime(layer.startAt, sortedStepPositions)}
              />
            </div>
          ))}

          {/* Overlay layer rows */}
          {overlayLayers.length === 0 ? (
            <>
              <div className="absolute left-0 pointer-events-none" style={{ top: OVERLAY_START, height: OVERLAY_ROW_H, width: 40 }}>
                <div className="flex items-center h-full px-1">
                  <span className="text-[9px] text-neutral-600 uppercase tracking-wider">Ovly</span>
                </div>
              </div>
              <div
                className="absolute left-0 right-0 rounded"
                style={{ top: OVERLAY_START, height: OVERLAY_ROW_H, background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="flex items-center h-full px-2">
                  <span className="text-[10px] text-neutral-700">No overlays · click "+ Add image" or "+ Add text"</span>
                </div>
              </div>
            </>
          ) : overlayLayers.map((ol, i) => (
            <div key={ol.id}>
              <div className="absolute left-0 pointer-events-none" style={{ top: getOverlayTop(i), height: OVERLAY_ROW_H, width: 40 }}>
                <div className="flex items-center h-full px-1">
                  <span className="text-[9px] text-neutral-600 uppercase tracking-wider">O{i + 1}</span>
                </div>
              </div>
              <div
                className="absolute left-0 right-0 rounded"
                style={{ top: getOverlayTop(i), height: OVERLAY_ROW_H, background: 'rgba(255,255,255,0.02)' }}
                onClick={e => { e.stopPropagation(); setSelectedOverlayId(ol.id) }}
              >
                <OverlayItem overlay={ol} zoom={zoom} selected={selectedOverlayId === ol.id} />
              </div>
            </div>
          ))}

          {/* Ghost hover indicator */}
          {hoverX !== null && hoverTime !== null && (
            <div
              className="absolute top-0 bottom-0 z-10 pointer-events-none"
              style={{ left: hoverX }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-px bg-white/20" />
              <div
                className="absolute top-1 text-[10px] font-mono text-white/50 bg-neutral-800/90 px-1 py-0.5 rounded whitespace-nowrap"
                style={{ left: 4 }}
              >
                {formatTime(hoverTime)}
              </div>
            </div>
          )}

          {/* Committed playhead */}
          <div
            className="absolute top-0 bottom-0 z-20 pointer-events-none"
            style={{ left: playheadX }}
          >
            <div
              className="absolute w-0 h-0"
              style={{
                top: 0,
                left: -5,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '8px solid #ef4444',
              }}
            />
            <div className="absolute left-0 top-0 bottom-0 w-px bg-red-500/90" />
          </div>
        </div>
      </div>

      {/* Clip reorder overlay */}
      {reorderOverlay && (
        <ClipReorderOverlay
          clips={clips}
          clipSpeeds={clipSpeeds}
          dragClipId={reorderOverlay.clipId}
          initialMouseX={reorderOverlay.mouseX}
          initialMouseY={reorderOverlay.mouseY}
          onReorder={(from, to) => reorderClips(from, to)}
          onClose={() => setReorderOverlay(null)}
        />
      )}
    </div>
  )
}
