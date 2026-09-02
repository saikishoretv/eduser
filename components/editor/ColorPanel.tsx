'use client'

import { useEditorStore } from '@/store/store'
import {
  COLOR_PRESETS,
  COLOR_CORRECTION_DEFAULT,
  ColorCorrection,
  toCssFilter,
} from '@/lib/colorPresets'

interface Props {
  onClose: () => void
}

const SLIDERS: Array<{
  key: keyof ColorCorrection
  label: string
  min: number
  max: number
  step: number
  unit: string
}> = [
  { key: 'brightness', label: 'Brightness', min: -1,   max: 1,   step: 0.05, unit: ''  },
  { key: 'contrast',   label: 'Contrast',   min: -1,   max: 1,   step: 0.05, unit: ''  },
  { key: 'saturation', label: 'Saturation', min: -1,   max: 1,   step: 0.05, unit: ''  },
  { key: 'hue',        label: 'Hue',        min: -180, max: 180, step: 1,    unit: '°' },
]

export default function ColorPanel({ onClose }: Props) {
  const selectedClipIds          = useEditorStore(s => s.selectedClipIds)
  const clipColorCorrections     = useEditorStore(s => s.clipColorCorrections)
  const setClipColorCorrection   = useEditorStore(s => s.setClipColorCorrection)
  const setAllClipsColorCorrection = useEditorStore(s => s.setAllClipsColorCorrection)

  const primaryClipId = selectedClipIds[0] ?? null
  const current: ColorCorrection = primaryClipId
    ? (clipColorCorrections[primaryClipId] ?? COLOR_CORRECTION_DEFAULT)
    : COLOR_CORRECTION_DEFAULT

  const hasSelection = selectedClipIds.length > 0

  function applyToSelected(cc: ColorCorrection) {
    selectedClipIds.forEach(id => setClipColorCorrection(id, cc))
  }

  function handleSlider(key: keyof ColorCorrection, value: number) {
    applyToSelected({ ...current, [key]: value })
  }

  const activePresetName = COLOR_PRESETS.find(p =>
    Math.abs(p.values.brightness - current.brightness) < 0.01 &&
    Math.abs(p.values.contrast   - current.contrast)   < 0.01 &&
    Math.abs(p.values.saturation - current.saturation) < 0.01 &&
    Math.abs(p.values.hue        - current.hue)        < 0.5
  )?.name ?? null

  const isDefault =
    current.brightness === 0 &&
    current.contrast   === 0 &&
    current.saturation === 0 &&
    current.hue        === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl w-[420px] max-w-full shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-white">Color Correction</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Scope notice */}
        <div className="px-5 pt-3.5">
          <p className="text-[11px] text-neutral-500">
            {hasSelection
              ? `Editing ${selectedClipIds.length} selected clip${selectedClipIds.length > 1 ? 's' : ''}`
              : 'Select clip(s) to edit, or use "Apply to all clips" below'}
          </p>
        </div>

        {/* Presets */}
        <div className="px-5 pt-3 pb-1">
          <p className="text-[10px] text-neutral-600 font-medium uppercase tracking-wider mb-2">Presets</p>
          <div className="grid grid-cols-3 gap-1.5">
            {COLOR_PRESETS.map(preset => {
              const isActive = activePresetName === preset.name
              const filterStr = toCssFilter(preset.values)
              return (
                <button
                  key={preset.name}
                  onClick={() => applyToSelected(preset.values)}
                  disabled={!hasSelection}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 ${
                    isActive
                      ? 'border-blue-500 text-white bg-blue-600/15'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                  }`}
                >
                  <div
                    className="w-full h-7 rounded overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, #1d4ed8 0%, #7c3aed 35%, #f97316 70%, #fbbf24 100%)',
                      filter: filterStr || 'none',
                    }}
                  />
                  {preset.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Manual sliders */}
        <div className="px-5 py-4 border-t border-neutral-800 mt-2">
          <p className="text-[10px] text-neutral-600 font-medium uppercase tracking-wider mb-3">Manual</p>
          <div className="space-y-3">
            {SLIDERS.map(({ key, label, min, max, step, unit }) => {
              const val = current[key]
              const isOff = val === COLOR_CORRECTION_DEFAULT[key]
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400 w-20 shrink-0">{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    disabled={!hasSelection}
                    onChange={e => handleSlider(key, parseFloat(e.target.value))}
                    className="flex-1 accent-blue-500 disabled:opacity-40"
                  />
                  <span className="text-xs text-neutral-400 tabular-nums w-14 text-right shrink-0">
                    {val > 0 ? '+' : ''}{key === 'hue' ? `${Math.round(val)}°` : val.toFixed(2)}
                  </span>
                  {!isOff && (
                    <button
                      onClick={() => handleSlider(key, COLOR_CORRECTION_DEFAULT[key])}
                      className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors shrink-0 w-8"
                    >
                      reset
                    </button>
                  )}
                  {isOff && <span className="w-8 shrink-0" />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-neutral-800">
          <button
            onClick={() => applyToSelected(COLOR_CORRECTION_DEFAULT)}
            disabled={!hasSelection || isDefault}
            className="text-xs text-neutral-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Reset selection
          </button>
          <button
            onClick={() => setAllClipsColorCorrection(current)}
            className="px-3 py-1.5 rounded-lg border border-neutral-600 text-xs text-neutral-300 hover:border-neutral-400 hover:text-white transition-colors"
          >
            Apply to all clips
          </button>
        </div>
      </div>
    </div>
  )
}
