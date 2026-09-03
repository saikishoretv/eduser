'use client'

import { useRef } from 'react'
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
  const setSelectedAudioLayerId = useEditorStore(s => s.setSelectedAudioLayerId)
  const setSelectedOverlayId    = useEditorStore(s => s.setSelectedOverlayId)
  const updateClip              = useEditorStore(s => s.updateClip)
  const sourceDuration          = useEditorStore(s =>
    s.projects.find(p => p.id === s.activeProjectId)?.sources.find(src => src.id === clip.sourceId)?.duration ?? clip.trimEnd
  )

  const leftTrimRef  = useRef<{ startX: number; trimStart: number } | null>(null)
  const rightTrimRef = useRef<{ startX: number; trimEnd: number } | null>(null)

  const colorClass = COLORS[index % COLORS.length]
  const widthPx = duration * zoom
  const leftPx = start * zoom

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    selectClip(clip.id, e.shiftKey || e.metaKey || e.ctrlKey)
    setSelectedAudioLayerId(null)
    setSelectedOverlayId(null)
  }

  function handleLeftTrimMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    leftTrimRef.current = { startX: e.clientX, trimStart: clip.trimStart }
    const move = (ev: MouseEvent) => {
      if (!leftTrimRef.current) return
      const delta = (ev.clientX - leftTrimRef.current.startX) / zoom
      const newTrimStart = Math.max(0, Math.min(leftTrimRef.current.trimStart + delta, clip.trimEnd - 0.1))
      updateClip(clip.id, { trimStart: newTrimStart })
    }
    const up = () => {
      leftTrimRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function handleRightTrimMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    rightTrimRef.current = { startX: e.clientX, trimEnd: clip.trimEnd }
    const move = (ev: MouseEvent) => {
      if (!rightTrimRef.current) return
      const delta = (ev.clientX - rightTrimRef.current.startX) / zoom
      const newTrimEnd = Math.max(clip.trimStart + 0.1, Math.min(rightTrimRef.current.trimEnd + delta, sourceDuration))
      updateClip(clip.id, { trimEnd: newTrimEnd })
    }
    const up = () => {
      rightTrimRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
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
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 bg-black/30 hover:bg-black/50"
        onMouseDown={handleLeftTrimMouseDown}
        onClick={e => e.stopPropagation()}
      />
      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 bg-black/30 hover:bg-black/50"
        onMouseDown={handleRightTrimMouseDown}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}
