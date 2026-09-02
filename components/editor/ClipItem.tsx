'use client'

import { useEditorStore } from '@/store/store'
import { ClipTiming } from '@/lib/clipUtils'

const COLORS = [
  'bg-blue-600 border-blue-400',
  'bg-violet-600 border-violet-400',
  'bg-emerald-600 border-emerald-400',
  'bg-amber-600 border-amber-400',
  'bg-rose-600 border-rose-400',
  'bg-cyan-600 border-cyan-400',
]

interface Props {
  timing: ClipTiming
  zoom: number
}

export default function ClipItem({ timing, zoom }: Props) {
  const { clip, start, duration, index } = timing

  const isSelected = useEditorStore(s => s.selectedClipIds.includes(clip.id))
  const selectClip = useEditorStore(s => s.selectClip)

  const colorClass = COLORS[index % COLORS.length]
  const widthPx = duration * zoom
  const leftPx = start * zoom

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    selectClip(clip.id, e.shiftKey || e.metaKey || e.ctrlKey)
  }

  return (
    <div
      onClick={handleClick}
      className={`absolute top-0 bottom-0 rounded border cursor-pointer overflow-hidden transition-all
        ${colorClass}
        ${isSelected
          ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-900 brightness-110'
          : 'hover:brightness-110'
        }
      `}
      style={{ left: leftPx, width: Math.max(widthPx - 2, 3) }}
    >
      {widthPx > 40 && (
        <span className="absolute inset-0 flex items-center px-2 text-[11px] text-white/90 font-medium truncate pointer-events-none select-none">
          {clip.name}
        </span>
      )}
    </div>
  )
}
