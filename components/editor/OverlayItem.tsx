'use client'

import { useRef } from 'react'
import { OverlayLayer } from '@/types'
import { useEditorStore } from '@/store/store'

interface Props {
  overlay: OverlayLayer
  zoom: number
  selected: boolean
}

export default function OverlayItem({ overlay, zoom, selected }: Props) {
  const updateOverlayLayer   = useEditorStore(s => s.updateOverlayLayer)
  const removeOverlayLayer   = useEditorStore(s => s.removeOverlayLayer)
  const setSelectedOverlayId = useEditorStore(s => s.setSelectedOverlayId)
  const pushUndo             = useEditorStore(s => s.pushUndo)

  const bodyDragRef  = useRef<{ startX: number; startAt: number } | null>(null)
  const resizeDragRef = useRef<{ startX: number; duration: number } | null>(null)

  const left  = overlay.startAt * zoom
  const width = Math.max(overlay.duration * zoom, 8)
  const label = overlay.type === 'text' ? (overlay.text || 'Text') : (overlay.fileName ?? 'Image')

  function handleBodyMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    pushUndo()
    bodyDragRef.current = { startX: e.clientX, startAt: overlay.startAt }
    const move = (ev: MouseEvent) => {
      if (!bodyDragRef.current) return
      const newStartAt = Math.max(0, bodyDragRef.current.startAt + (ev.clientX - bodyDragRef.current.startX) / zoom)
      updateOverlayLayer(overlay.id, { startAt: newStartAt })
    }
    const up = () => {
      bodyDragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    pushUndo()
    resizeDragRef.current = { startX: e.clientX, duration: overlay.duration }
    const move = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return
      const newDuration = Math.max(0.5, resizeDragRef.current.duration + (ev.clientX - resizeDragRef.current.startX) / zoom)
      updateOverlayLayer(overlay.id, { duration: newDuration })
    }
    const up = () => {
      resizeDragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      className={`absolute top-0 bottom-0 flex items-center rounded cursor-grab select-none overflow-hidden
        border transition-colors ${overlay.type === 'text'
          ? selected ? 'bg-violet-950 border-violet-400' : 'bg-violet-950 border-violet-700 hover:border-violet-500'
          : selected ? 'bg-pink-950 border-pink-400'   : 'bg-pink-950 border-pink-700 hover:border-pink-500'
        }`}
      style={{ left, width }}
      onMouseDown={handleBodyMouseDown}
      onClick={e => { e.stopPropagation(); setSelectedOverlayId(overlay.id) }}
    >
      {/* stripe pattern */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: overlay.type === 'text'
            ? 'repeating-linear-gradient(90deg,transparent,transparent 6px,rgba(167,139,250,0.4) 6px,rgba(167,139,250,0.4) 7px)'
            : 'repeating-linear-gradient(90deg,transparent,transparent 6px,rgba(244,114,182,0.4) 6px,rgba(244,114,182,0.4) 7px)',
        }}
      />

      <div className="relative flex items-center gap-1.5 px-2 w-full overflow-hidden">
        {overlay.type === 'text' ? (
          <svg className="w-3 h-3 text-violet-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M5 4v3h5.5v12h3V7H19V4z" />
          </svg>
        ) : (
          <svg className="w-3 h-3 text-pink-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        )}
        <span className={`text-[10px] font-medium truncate flex-1 min-w-0 ${overlay.type === 'text' ? 'text-violet-300' : 'text-pink-300'}`}>
          {label}
        </span>

        {selected && (
          <button
            onClick={e => { e.stopPropagation(); removeOverlayLayer(overlay.id) }}
            onMouseDown={e => e.stopPropagation()}
            className="w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-300 text-base leading-none shrink-0"
          >
            ×
          </button>
        )}
      </div>

      {/* Right-edge resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  )
}
