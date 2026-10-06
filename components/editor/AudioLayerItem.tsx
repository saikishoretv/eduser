'use client'

import { useRef, useState } from 'react'
import { AudioLayer } from '@/types'
import { useEditorStore } from '@/store/store'

const STEP_ACCENTS = ['#2563eb','#7c3aed','#059669','#d97706','#e11d48','#0891b2']

interface Props {
  layer: AudioLayer
  zoom: number
  selected: boolean
  stepColorIdx?: number
}

export default function AudioLayerItem({ layer, zoom, selected, stepColorIdx }: Props) {
  const updateAudioLayer        = useEditorStore(s => s.updateAudioLayer)
  const removeAudioLayer        = useEditorStore(s => s.removeAudioLayer)
  const setSelectedAudioLayerId = useEditorStore(s => s.setSelectedAudioLayerId)
  const pushUndo                = useEditorStore(s => s.pushUndo)
  const dragRef      = useRef<{ startX: number; startAt: number } | null>(null)
  const leftTrimRef  = useRef<{ startX: number; trimStart: number; startAt: number } | null>(null)
  const rightTrimRef = useRef<{ startX: number; trimEnd: number } | null>(null)
  const [leftDragging,  setLeftDragging]  = useState(false)
  const [rightDragging, setRightDragging] = useState(false)

  const layerDuration = layer.trimEnd - layer.trimStart
  const left  = layer.startAt * zoom
  const width = Math.max(layerDuration * zoom, 4)

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    pushUndo()
    dragRef.current = { startX: e.clientX, startAt: layer.startAt }

    const handleMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const newStartAt = Math.max(0, drag.startAt + (ev.clientX - drag.startX) / zoom)
      updateAudioLayer(layer.id, { startAt: newStartAt })
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  function handleLeftTrimMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    pushUndo()
    setLeftDragging(true)
    leftTrimRef.current = { startX: e.clientX, trimStart: layer.trimStart, startAt: layer.startAt }
    const move = (ev: MouseEvent) => {
      if (!leftTrimRef.current) return
      const delta = (ev.clientX - leftTrimRef.current.startX) / zoom
      const newTrimStart = Math.max(0, Math.min(leftTrimRef.current.trimStart + delta, layer.trimEnd - 0.1))
      const actualDelta = newTrimStart - leftTrimRef.current.trimStart
      const newStartAt  = Math.max(0, leftTrimRef.current.startAt + actualDelta)
      updateAudioLayer(layer.id, { trimStart: newTrimStart, startAt: newStartAt })
    }
    const up = () => {
      leftTrimRef.current = null
      setLeftDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function handleRightTrimMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    pushUndo()
    setRightDragging(true)
    rightTrimRef.current = { startX: e.clientX, trimEnd: layer.trimEnd }
    const move = (ev: MouseEvent) => {
      if (!rightTrimRef.current) return
      const delta = (ev.clientX - rightTrimRef.current.startX) / zoom
      const newTrimEnd = Math.max(layer.trimStart + 0.1, Math.min(rightTrimRef.current.trimEnd + delta, layer.duration))
      updateAudioLayer(layer.id, { trimEnd: newTrimEnd })
    }
    const up = () => {
      rightTrimRef.current = null
      setRightDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const volume = layer.volume ?? 1
  // Bar height: 30% minimum so it's always visible, scales up to 100% at full volume
  const heightPct = Math.round(30 + volume * 70)

  return (
    <div
      className="absolute flex items-center"
      style={{ left, width, top: 0, bottom: 0 }}
      onMouseDown={handleMouseDown}
      onClick={e => { e.stopPropagation(); setSelectedAudioLayerId(layer.id) }}
    >
    <div
      className={`w-full relative flex items-center rounded cursor-grab select-none overflow-hidden
        bg-emerald-950 border transition-all duration-150
        ${selected ? 'border-emerald-400' : 'border-emerald-800 hover:border-emerald-600'}`}
      style={{ height: `${heightPct}%` }}
    >
      {/* Step accent line */}
      {stepColorIdx !== undefined && (
        <div
          className="absolute top-0 left-0 right-0 h-0.5 pointer-events-none"
          style={{ background: STEP_ACCENTS[stepColorIdx % STEP_ACCENTS.length] }}
        />
      )}
      {/* Stripe pattern to hint it's audio */}
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 6px, rgba(52,211,153,0.4) 6px, rgba(52,211,153,0.4) 7px)' }}
      />

      {/* Left trim handle */}
      <div
        aria-label="Trim start"
        className={`absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 transition-colors ${leftDragging ? 'bg-white/40' : 'bg-black/40 hover:bg-white/25'}`}
        onMouseDown={handleLeftTrimMouseDown}
        onClick={e => e.stopPropagation()}
      />
      {/* Right trim handle */}
      <div
        aria-label="Trim end"
        className={`absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 transition-colors ${rightDragging ? 'bg-white/40' : 'bg-black/40 hover:bg-white/25'}`}
        onMouseDown={handleRightTrimMouseDown}
        onClick={e => e.stopPropagation()}
      />
      <div className="relative flex items-center gap-1.5 px-2 w-full overflow-hidden">
        {/* Music icon */}
        <svg className="w-3 h-3 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 3v10.55A4 4 0 1 0 11 17V7h4V3H9z"/>
        </svg>
        <span className="text-[10px] text-emerald-300 font-medium truncate flex-1 min-w-0">{layer.name}</span>

        {selected && (
          <div className="flex items-center gap-1.5 shrink-0" onMouseDown={e => e.stopPropagation()}>
            {/* Volume */}
            <span className="text-[9px] text-emerald-500">{Math.round(layer.volume * 100)}%</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={layer.volume}
              onChange={e => updateAudioLayer(layer.id, { volume: parseFloat(e.target.value) })}
              onClick={e => e.stopPropagation()}
              aria-label="Volume"
              className="w-16 accent-emerald-400"
            />
            {/* Delete */}
            <button
              onClick={e => { e.stopPropagation(); removeAudioLayer(layer.id) }}
              aria-label="Remove audio layer"
              className="w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-300 text-base leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
