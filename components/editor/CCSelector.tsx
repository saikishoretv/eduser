'use client'

import { useEffect, useRef, useState } from 'react'
import { useEditorStore, SubtitleStyle } from '@/store/store'
import {
  SubtitleAppearance,
  StandardSubtitleAppearance,
  STANDARD_PRESETS,
  HIGHLIGHT_PRESETS,
  hexToRgba,
} from '@/lib/subtitleTemplates'

const MODES: { key: SubtitleStyle; label: string }[] = [
  { key: 'off',       label: 'Off' },
  { key: 'standard',  label: 'Standard' },
  { key: 'highlight', label: 'Word Highlight' },
]

export default function CCSelector() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const subtitleStyle         = useEditorStore(s => s.subtitleStyle)
  const setSubtitleStyle      = useEditorStore(s => s.setSubtitleStyle)
  const appearance            = useEditorStore(s => s.subtitleAppearance)
  const setAppearance         = useEditorStore(s => s.setSubtitleAppearance)
  const standardAppearance    = useEditorStore(s => s.standardSubtitleAppearance)
  const setStandardAppearance = useEditorStore(s => s.setStandardSubtitleAppearance)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function patchHighlight(updates: Partial<SubtitleAppearance>) {
    setAppearance({ ...appearance, preset: 'custom', ...updates })
  }

  function patchStandard(updates: Partial<StandardSubtitleAppearance>) {
    setStandardAppearance({ ...standardAppearance, preset: 'custom', ...updates })
  }

  const modeLabel =
    subtitleStyle === 'off'       ? 'CC Off'       :
    subtitleStyle === 'standard'  ? 'CC Standard'  : 'CC Highlight'

  const isStdCustom  = standardAppearance.preset === 'custom'
  const isHiCustom   = appearance.preset === 'custom'

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
          open
            ? 'border-blue-500 bg-blue-500/10 text-blue-400'
            : subtitleStyle !== 'off'
            ? 'border-neutral-600 text-white bg-neutral-700'
            : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
        }`}
      >
        {modeLabel}
        <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-50 overflow-hidden">

          {/* Mode tabs */}
          <div className="flex border-b border-neutral-800">
            {MODES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSubtitleStyle(key)}
                className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                  subtitleStyle === key
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {subtitleStyle === 'off' && (
            <p className="px-4 py-4 text-xs text-neutral-500 text-center">Subtitles are hidden</p>
          )}

          {/* Standard settings */}
          {subtitleStyle === 'standard' && (
            <div className="p-3 space-y-3">
              {/* Preset row */}
              <div className="flex flex-wrap gap-1.5">
                {STANDARD_PRESETS.map(preset => {
                  const isActive = standardAppearance.preset === preset.id
                  const { textColor, bgColor, bgOpacity } = preset.value
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setStandardAppearance({ preset: preset.id, ...preset.value })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                          : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                      }`}
                    >
                      {/* Mini swatch */}
                      <span
                        className="inline-block rounded px-1 text-[9px] font-bold leading-tight"
                        style={{
                          color: textColor,
                          background: bgOpacity > 0 ? hexToRgba(bgColor, bgOpacity) : 'transparent',
                          border: bgOpacity === 0 ? `1px solid ${textColor}` : undefined,
                        }}
                      >
                        Aa
                      </span>
                      {preset.label}
                    </button>
                  )
                })}
                {/* Custom */}
                <button
                  onClick={() => setStandardAppearance({ ...standardAppearance, preset: 'custom' })}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    isStdCustom
                      ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                  }`}
                >
                  Custom
                </button>
              </div>

              {/* Custom pickers */}
              {isStdCustom && (
                <div className="space-y-2 pt-1 border-t border-neutral-800">
                  <ColorRow label="Text color"  color={standardAppearance.textColor} onChange={v => patchStandard({ textColor: v })} />
                  <ColorRow label="Background"  color={standardAppearance.bgColor}   onChange={v => patchStandard({ bgColor: v })} />
                  <OpacityRow label="BG opacity" value={standardAppearance.bgOpacity} onChange={v => patchStandard({ bgOpacity: v })} />
                </div>
              )}

              {/* Live preview */}
              <div className="flex justify-center pt-0.5">
                <span
                  className="px-3 py-1 rounded text-sm font-medium"
                  style={{
                    color: standardAppearance.textColor,
                    background: standardAppearance.bgOpacity > 0
                      ? hexToRgba(standardAppearance.bgColor, standardAppearance.bgOpacity)
                      : 'transparent',
                  }}
                >
                  Subtitle text preview
                </span>
              </div>
            </div>
          )}

          {/* Highlight settings */}
          {subtitleStyle === 'highlight' && (
            <div className="p-3 space-y-3">
              {/* Preset row */}
              <div className="flex flex-wrap gap-1.5">
                {HIGHLIGHT_PRESETS.map(preset => {
                  const isActive = appearance.preset === preset.id
                  const { highlightColor, inactiveColor, inactiveOpacity, bgColor, bgOpacity } = preset.value
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setAppearance({ preset: preset.id, ...preset.value })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                          : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                      }`}
                    >
                      {/* Mini word preview */}
                      <span
                        className="inline-flex gap-0.5 rounded px-1 py-0.5"
                        style={bgOpacity > 0 ? { background: hexToRgba(bgColor, bgOpacity) } : undefined}
                      >
                        <span style={{ color: inactiveColor, opacity: inactiveOpacity, fontSize: 8, fontWeight: 700 }}>hi</span>
                        <span style={{ color: highlightColor, fontSize: 8, fontWeight: 700 }}>there</span>
                      </span>
                      {preset.label}
                    </button>
                  )
                })}
                {/* Custom */}
                <button
                  onClick={() => setAppearance({ ...appearance, preset: 'custom' })}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    isHiCustom
                      ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                  }`}
                >
                  Custom
                </button>
              </div>

              {/* Custom pickers */}
              {isHiCustom && (
                <div className="space-y-2 pt-1 border-t border-neutral-800">
                  <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Words</p>
                  <ColorRow label="Active word"     color={appearance.highlightColor}  onChange={v => patchHighlight({ highlightColor: v })} />
                  <ColorRow label="Inactive words"  color={appearance.inactiveColor}   onChange={v => patchHighlight({ inactiveColor: v })} />
                  <OpacityRow label="Inactive opacity" value={appearance.inactiveOpacity} onChange={v => patchHighlight({ inactiveOpacity: v })} />
                  <p className="text-[10px] text-neutral-500 uppercase tracking-wider pt-1">Background</p>
                  <ColorRow label="BG color"   color={appearance.bgColor}   onChange={v => patchHighlight({ bgColor: v })} />
                  <OpacityRow label="BG opacity" value={appearance.bgOpacity} onChange={v => patchHighlight({ bgOpacity: v })} />
                </div>
              )}

              {/* Live preview */}
              <div className="flex justify-center pt-0.5">
                <span
                  className="px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                  style={appearance.bgOpacity > 0
                    ? { background: hexToRgba(appearance.bgColor, appearance.bgOpacity) }
                    : undefined
                  }
                >
                  {['one', 'two', 'three', 'four'].map((w, i) => (
                    <span
                      key={i}
                      className="text-sm font-bold"
                      style={i === 1
                        ? { color: appearance.highlightColor }
                        : { color: appearance.inactiveColor, opacity: appearance.inactiveOpacity }
                      }
                    >
                      {w}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ColorRow({ label, color, onChange }: { label: string; color: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-neutral-400">{label}</span>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <span className="text-[11px] text-neutral-500 font-mono">{color}</span>
        <div className="w-5 h-5 rounded border border-neutral-600 overflow-hidden shrink-0" style={{ background: color }}>
          <input
            type="color"
            value={color}
            onChange={e => onChange(e.target.value)}
            className="opacity-0 w-full h-full cursor-pointer block"
          />
        </div>
      </label>
    </div>
  )
}

function OpacityRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-400 shrink-0">{label}</span>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500"
      />
      <span className="text-[11px] text-neutral-500 font-mono w-8 text-right">{Math.round(value * 100)}%</span>
    </div>
  )
}
