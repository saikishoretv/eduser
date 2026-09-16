import { Clip } from '@/types'

export interface ClipTiming {
  clip: Clip
  start: number    // absolute timeline start (seconds)
  end: number      // absolute timeline end (seconds)
  duration: number
  index: number
}

export function getClipTimings(clips: Clip[], clipSpeeds?: Record<string, number>): ClipTiming[] {
  let t = 0
  return clips.map((clip, index) => {
    const speed = clipSpeeds?.[clip.id] ?? 1
    const duration = (clip.trimEnd - clip.trimStart) / speed
    const timing: ClipTiming = { clip, start: t, end: t + duration, duration, index }
    t += duration
    return timing
  })
}

export function getTotalDuration(clips: Clip[], clipSpeeds?: Record<string, number>): number {
  return clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart) / (clipSpeeds?.[c.id] ?? 1), 0)
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function getSelectedIndices(clips: Clip[], selectedIds: string[]): number[] {
  return selectedIds
    .map(id => clips.findIndex(c => c.id === id))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)
}

function areConsecutive(indices: number[]): boolean {
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false
  }
  return true
}

export function canMerge(clips: Clip[], selectedIds: string[]): boolean {
  if (selectedIds.length < 2) return false
  const indices = getSelectedIndices(clips, selectedIds)
  if (indices.length < 2) return false
  if (!areConsecutive(indices)) return false
  const selected = indices.map(i => clips[i])
  if (!selected.every(c => c.sourceId === selected[0].sourceId)) return false
  for (let i = 1; i < selected.length; i++) {
    if (Math.abs(selected[i].trimStart - selected[i - 1].trimEnd) > 0.001) return false
  }
  return true
}

export function getTickInterval(zoom: number): number {
  const minPx = 60
  const raw = minPx / zoom
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find(n => n >= raw) ?? 600
}
