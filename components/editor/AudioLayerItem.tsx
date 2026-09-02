'use client'

import { useRef } from 'react'
import { AudioLayer } from '@/types'
import { useEditorStore } from '@/store/store'

interface Props {
  layer: AudioLayer
  zoom: number
  selected: boolean
}

export default function AudioLayerItem({ layer, zoom, selected }: Props) {
  const updateAudioLayer      = useEditorStore(s => s.updateAudioLayer)
  const removeAudioLayer      = useEditorStore(s => s.removeAudioLayer)
  const setSelectedAudioLayerId = useEditorStore(s => s.setSelectedAudioLayerId)

  const dragRef = useRef<{ startX: number; startAt: number } | null>(null)

  const layerDuration = layer.trimEnd - layer.trimStart
  const left  = layer.startAt * zoom
  const width = Math.max(layerDuration * zoom, 4)

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
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

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedAudioLayerId(selected ? null : layer.id)
  }

  const volume = layer.volume ?? 1
  // Bar height: 30% minimum so it's always visible, scales up to 100% at full volume
  const heightPct = Math.round(30 + volume * 70)

  return (
    <div
      className="absolute flex items-center"
      style={{ left, width, top: 0, bottom: 0 }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
    <div
      className={`w-full flex items-center rounded cursor-grab select-none overflow-hidden
        bg-emerald-950 border transition-all duration-150
        ${selected ? 'border-emerald-400' : 'border-emerald-800 hover:border-emerald-600'}`}
      style={{ height: `${heightPct}%` }}
    >
      {/* Stripe pattern to hint it's audio */}
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 6px, rgba(52,211,153,0.4) 6px, rgba(52,211,153,0.4) 7px)' }}
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
              className="w-16 accent-emerald-400"
            />
            {/* Delete */}
            <button
              onClick={e => { e.stopPropagation(); removeAudioLayer(layer.id) }}
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
