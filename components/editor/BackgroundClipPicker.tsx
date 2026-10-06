'use client'

import { useState } from 'react'
import { ClipBackground } from '@/types'

const SOLID_PRESETS = [
  '#ffffff', '#000000', '#18181b', '#27272a',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

const GRADIENT_PRESETS: { label: string; value: string }[] = [
  { label: 'Sunset',   value: 'linear-gradient(135deg, #f97316, #ec4899)' },
  { label: 'Ocean',    value: 'linear-gradient(135deg, #3b82f6, #06b6d4)' },
  { label: 'Forest',   value: 'linear-gradient(135deg, #22c55e, #14b8a6)' },
  { label: 'Dusk',     value: 'linear-gradient(135deg, #a855f7, #3b82f6)' },
  { label: 'Amber',    value: 'linear-gradient(135deg, #fbbf24, #f97316)' },
  { label: 'Rose',     value: 'linear-gradient(135deg, #f9a8d4, #ec4899)' },
  { label: 'Midnight', value: 'linear-gradient(135deg, #0f172a, #1e40af)' },
  { label: 'Charcoal', value: 'linear-gradient(135deg, #27272a, #18181b)' },
  { label: 'Lavender', value: 'linear-gradient(135deg, #c4b5fd, #a78bfa)' },
  { label: 'Aurora',   value: 'linear-gradient(135deg, #34d399, #3b82f6, #a855f7)' },
  { label: 'Desert',   value: 'linear-gradient(135deg, #fef3c7, #fca5a5)' },
  { label: 'Abyss',    value: 'linear-gradient(135deg, #0c4a6e, #0ea5e9)' },
]

interface Props {
  onSelect: (bg: ClipBackground) => void
  onClose: () => void
}

export default function BackgroundClipPicker({ onSelect, onClose }: Props) {
  const [tab, setTab] = useState<'solid' | 'gradient'>('solid')
  const [selected, setSelected] = useState<ClipBackground>({ type: 'solid', value: '#ffffff' })
  const [customColor, setCustomColor] = useState('#ffffff')

  function handleSolid(hex: string) {
    setCustomColor(hex)
    setSelected({ type: 'solid', value: hex })
  }

  function handleGradient(value: string) {
    setSelected({ type: 'gradient', value })
  }

  return (
    <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-3">
      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {(['solid', 'gradient'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs py-1 rounded capitalize transition-colors ${
              tab === t ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'solid' && (
        <div>
          <div className="grid grid-cols-6 gap-1.5 mb-3">
            {SOLID_PRESETS.map(hex => (
              <button
                key={hex}
                onClick={() => handleSolid(hex)}
                className={`w-7 h-7 rounded border transition-all ${
                  selected.type === 'solid' && selected.value === hex
                    ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-neutral-900'
                    : 'border-neutral-600 hover:border-neutral-400'
                }`}
                style={{ background: hex }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={customColor}
              onChange={e => handleSolid(e.target.value)}
              className="w-7 h-7 rounded border border-neutral-600 cursor-pointer bg-transparent p-0.5"
            />
            <span className="text-xs text-neutral-400">Custom color</span>
            <span className="text-xs text-neutral-600 font-mono ml-auto">{customColor}</span>
          </div>
        </div>
      )}

      {tab === 'gradient' && (
        <div className="grid grid-cols-3 gap-2">
          {GRADIENT_PRESETS.map(g => (
            <button
              key={g.value}
              onClick={() => handleGradient(g.value)}
              title={g.label}
              className={`h-12 rounded border transition-all ${
                selected.type === 'gradient' && selected.value === g.value
                  ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-neutral-900 border-transparent'
                  : 'border-neutral-600 hover:border-neutral-400'
              }`}
              style={{ background: g.value }}
            />
          ))}
        </div>
      )}

      {/* Preview + actions */}
      <div className="mt-3 flex items-center gap-2">
        <div
          className="w-10 h-7 rounded border border-neutral-600 shrink-0"
          style={{ background: selected.value }}
        />
        <button
          onClick={() => onSelect(selected)}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 rounded transition-colors"
        >
          Add clip
        </button>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200 text-xs px-2 py-1.5 rounded hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
