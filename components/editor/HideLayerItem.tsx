'use client'

import { HideLayer } from '@/types'

interface Props {
  layer: HideLayer
  zoom: number
  rowTop: number
  rowH: number
  selected: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<Omit<HideLayer, 'id' | 'style'>>) => void
}

export default function HideLayerItem({ layer, zoom, rowTop, rowH, selected, onSelect, onUpdate }: Props) {
  const left  = layer.startAt * zoom
  const width = Math.max(2, layer.duration * zoom)

  function startLeftDrag(e: React.MouseEvent) {
    e.stopPropagation()
    const origStart = layer.startAt
    const origEnd   = layer.startAt + layer.duration
    const startX    = e.clientX
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const newStart = Math.max(0, Math.min(origEnd - 0.1, origStart + dx / zoom))
      onUpdate({ startAt: newStart, duration: origEnd - newStart })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startRightDrag(e: React.MouseEvent) {
    e.stopPropagation()
    const origEnd = layer.startAt + layer.duration
    const startX  = e.clientX
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const newEnd = Math.max(layer.startAt + 0.1, origEnd + dx / zoom)
      onUpdate({ duration: newEnd - layer.startAt })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const accent = layer.style === 'blur' ? '#a855f7' : '#6b7280'

  return (
    <div className="absolute" style={{ left, width, top: rowTop, height: rowH }}>
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 z-10 cursor-ew-resize flex items-center justify-center group"
        onMouseDown={startLeftDrag}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-0.5 h-4 rounded-full bg-white/60 group-hover:bg-white transition-colors" />
      </div>

      {/* Body */}
      <div
        className="absolute inset-x-2 inset-y-0 rounded cursor-grab overflow-hidden flex items-center px-1.5"
        style={{
          background: accent + '33',
          opacity: selected ? 1 : 0.75,
          outline: selected ? '2px solid white' : `1px solid ${accent}88`,
          outlineOffset: selected ? '-2px' : '-1px',
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => {
          e.stopPropagation()
          onSelect()
          const origStart = layer.startAt
          const startX    = e.clientX
          let dragging    = false
          const onMove = (ev: MouseEvent) => {
            if (!dragging) {
              if (Math.abs(ev.clientX - startX) < 4) return
              dragging = true
            }
            const newStart = Math.max(0, origStart + (ev.clientX - startX) / zoom)
            onUpdate({ startAt: newStart })
          }
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
      >
        <span className="text-[9px] font-medium text-white/90 truncate leading-none select-none">
          {layer.style === 'blur' ? 'Blur' : 'Hide'}
        </span>
      </div>

      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 z-10 cursor-ew-resize flex items-center justify-center group"
        onMouseDown={startRightDrag}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-0.5 h-4 rounded-full bg-white/60 group-hover:bg-white transition-colors" />
      </div>
    </div>
  )
}
