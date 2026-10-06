'use client'

import { useEffect, useRef, useState } from 'react'
import { Clip } from '@/types'
import { getClipTimings, formatTime } from '@/lib/clipUtils'

const CARD_W = 100
const CARD_H = 76
const CARD_GAP = 10

// Hex equivalents of the COLORS classes in ClipItem
const CLIP_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#e11d48', '#0891b2']

interface Props {
  clips: Clip[]
  clipSpeeds: Record<string, number>
  dragClipId: string
  initialMouseX: number
  initialMouseY: number
  onReorder: (fromIndex: number, toIndex: number) => void
  onClose: () => void
}

export default function ClipReorderOverlay({
  clips, clipSpeeds, dragClipId, initialMouseX, initialMouseY, onReorder, onClose,
}: Props) {
  const timings = getClipTimings(clips, clipSpeeds)
  const fromIdx = clips.findIndex(c => c.id === dragClipId)

  const containerRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState({ x: initialMouseX, y: initialMouseY })
  const [dropIdx, setDropIdx] = useState(fromIdx)
  const dropIdxRef = useRef(fromIdx)

  function computeDropIdx(mouseX: number): number {
    const container = containerRef.current
    if (!container) return fromIdx
    const rect = container.getBoundingClientRect()
    const relX = mouseX - rect.left
    const totalW = clips.length * CARD_W + (clips.length - 1) * CARD_GAP
    const startX = Math.max(0, (rect.width - totalW) / 2)
    const relToCards = relX - startX

    let idx = 0
    for (let i = 0; i < clips.length; i++) {
      if (relToCards > i * (CARD_W + CARD_GAP) + CARD_W / 2) idx = i + 1
    }
    return Math.max(0, Math.min(idx, clips.length))
  }

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
      const idx = computeDropIdx(e.clientX)
      setDropIdx(idx)
      dropIdxRef.current = idx
    }
    const handleUp = () => {
      const to = dropIdxRef.current > fromIdx ? dropIdxRef.current - 1 : dropIdxRef.current
      if (to !== fromIdx) onReorder(fromIdx, to)
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('keydown', handleKey)
    }
  }, [fromIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  const dragged = clips[fromIdx]
  const draggedColor = dragged?.background?.value ?? CLIP_COLORS[fromIdx % CLIP_COLORS.length]

  return (
    <>
      {/* Full-screen backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-[2px]" onMouseDown={onClose} />

      {/* Panel — sits directly above the timeline via bottom: 100% */}
      <div className="absolute bottom-full left-0 right-0 z-50">
        <div className="bg-neutral-950/95 border-t border-neutral-800 shadow-2xl px-6 py-4">
          <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-3 text-center select-none">
            Drag to reorder · release to confirm · Esc to cancel
          </p>

          {/* Cards row */}
          <div
            ref={containerRef}
            className="flex items-center justify-center overflow-x-auto pb-1"
            style={{ gap: CARD_GAP }}
          >
            {clips.map((clip, i) => {
              const timing = timings[i]
              const isGhost = clip.id === dragClipId
              const color = clip.background?.value ?? CLIP_COLORS[i % CLIP_COLORS.length]
              const dur = timing ? timing.duration : clip.trimEnd - clip.trimStart

              return (
                <div key={clip.id} className="relative flex-shrink-0 flex items-stretch">
                  {/* Drop indicator before this card */}
                  {dropIdx === i && (
                    <div className="absolute -left-[7px] inset-y-0 w-[3px] rounded-full bg-blue-400 z-10"
                      style={{ boxShadow: '0 0 8px #60a5fa' }}
                    />
                  )}

                  {/* Card */}
                  <div
                    className={`relative rounded-lg border overflow-hidden flex-shrink-0 select-none transition-opacity duration-100 ${
                      isGhost
                        ? 'opacity-20 border-dashed border-neutral-500'
                        : 'border-neutral-700 hover:border-neutral-500'
                    }`}
                    style={{ width: CARD_W, height: CARD_H, background: color }}
                  >
                    {/* Index badge */}
                    <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center">
                      <span className="text-[8px] text-white/70 font-bold">{i + 1}</span>
                    </div>

                    {/* Bottom label */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1">
                      <p className="text-[10px] text-white font-medium truncate leading-tight">
                        {clip.name || `Clip ${i + 1}`}
                      </p>
                      <p className="text-[9px] text-white/50 leading-tight">{formatTime(dur)}</p>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Drop indicator at end */}
            {dropIdx === clips.length && (
              <div
                className="flex-shrink-0 self-stretch w-[3px] rounded-full bg-blue-400"
                style={{ boxShadow: '0 0 8px #60a5fa' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Floating dragged card — follows cursor */}
      {dragged && (
        <div
          className="fixed pointer-events-none z-[200] rounded-lg border-2 border-blue-400 overflow-hidden"
          style={{
            width: CARD_W,
            height: CARD_H,
            left: mousePos.x - CARD_W / 2,
            top: mousePos.y - CARD_H / 2,
            background: draggedColor,
            transform: 'scale(1.1) rotate(-1deg)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7), 0 0 0 2px #60a5fa',
            transition: 'transform 0.1s',
          }}
        >
          <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center">
            <span className="text-[8px] text-white/70 font-bold">{fromIdx + 1}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-1">
            <p className="text-[10px] text-white font-medium truncate">{dragged.name || 'Clip'}</p>
          </div>
        </div>
      )}
    </>
  )
}
