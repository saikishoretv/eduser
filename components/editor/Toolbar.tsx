'use client'

import { useState } from 'react'
import { useEditorStore } from '@/store/store'
import { ZoomPreset } from '@/store/store'
import { canMerge } from '@/lib/clipUtils'
import { COLOR_PRESETS, COLOR_CORRECTION_DEFAULT, ColorCorrection } from '@/lib/colorPresets'

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

export default function Toolbar() {
  const [showColor, setShowColor] = useState(false)

  const selectedClipIds        = useEditorStore(s => s.selectedClipIds)
  const clipboard              = useEditorStore(s => s.clipboard)
  const activeProjectId        = useEditorStore(s => s.activeProjectId)
  const projects               = useEditorStore(s => s.projects)
  const clipZooms              = useEditorStore(s => s.clipZooms)
  const clipZoomPresets        = useEditorStore(s => s.clipZoomPresets)
  const clipTransitionDurations = useEditorStore(s => s.clipTransitionDurations)
  const clipColorCorrections   = useEditorStore(s => s.clipColorCorrections)

  const split              = useEditorStore(s => s.split)
  const cut                = useEditorStore(s => s.cut)
  const copy               = useEditorStore(s => s.copy)
  const paste              = useEditorStore(s => s.paste)
  const duplicate          = useEditorStore(s => s.duplicate)
  const merge              = useEditorStore(s => s.merge)
  const deleteSelected     = useEditorStore(s => s.deleteSelected)
  const detachAudio        = useEditorStore(s => s.detachAudio)
  const selectedAudioLayerId = useEditorStore(s => s.selectedAudioLayerId)
  const splitAudioLayer    = useEditorStore(s => s.splitAudioLayer)
  const cutAudioLayer      = useEditorStore(s => s.cutAudioLayer)
  const copyAudioLayer     = useEditorStore(s => s.copyAudioLayer)
  const pasteAudioLayer    = useEditorStore(s => s.pasteAudioLayer)
  const duplicateAudioLayer = useEditorStore(s => s.duplicateAudioLayer)
  const removeAudioLayer    = useEditorStore(s => s.removeAudioLayer)
  const updateAudioLayer    = useEditorStore(s => s.updateAudioLayer)
  const audioLayerClipboard = useEditorStore(s => s.audioLayerClipboard)
  const setClipZoom              = useEditorStore(s => s.setClipZoom)
  const setClipZoomPreset        = useEditorStore(s => s.setClipZoomPreset)
  const setClipTransitionDuration = useEditorStore(s => s.setClipTransitionDuration)
  const setClipColorCorrection   = useEditorStore(s => s.setClipColorCorrection)
  const setAllClipsColorCorrection = useEditorStore(s => s.setAllClipsColorCorrection)
  const selectedOverlayId        = useEditorStore(s => s.selectedOverlayId)
  const setSelectedOverlayId     = useEditorStore(s => s.setSelectedOverlayId)
  const updateOverlayLayer       = useEditorStore(s => s.updateOverlayLayer)
  const removeOverlayLayer       = useEditorStore(s => s.removeOverlayLayer)
  const cutOverlayLayer          = useEditorStore(s => s.cutOverlayLayer)
  const copyOverlayLayer         = useEditorStore(s => s.copyOverlayLayer)
  const pasteOverlayLayer        = useEditorStore(s => s.pasteOverlayLayer)
  const duplicateOverlayLayer    = useEditorStore(s => s.duplicateOverlayLayer)
  const overlayClipboard         = useEditorStore(s => s.overlayClipboard)

  const project       = projects.find(p => p.id === activeProjectId) ?? null
  const hasSelection  = selectedClipIds.length > 0
  const hasClipboard  = clipboard.length > 0
  const canMergeClips = project ? canMerge(project.clips, selectedClipIds) : false

  // ── Zoom ────────────────────────────────────────────────────────────────────
  const selectedZooms = selectedClipIds.map(id => clipZooms[id] ?? 1)
  const avgZoom = selectedZooms.length > 0
    ? selectedZooms.reduce((a, b) => a + b, 0) / selectedZooms.length
    : 1
  const selectedPresets = selectedClipIds.map(id => clipZoomPresets[id] ?? 'none')
  const activeZoomPreset: ZoomPreset | 'mixed' = selectedPresets.every(p => p === selectedPresets[0])
    ? selectedPresets[0] ?? 'none'
    : 'mixed'
  const selectedTransitions = selectedClipIds.map(id => clipTransitionDurations[id] ?? 0.5)
  const avgTransition = selectedTransitions.length > 0
    ? selectedTransitions.reduce((a, b) => a + b, 0) / selectedTransitions.length
    : 0.5

  const handleZoomChange = (value: number) => selectedClipIds.forEach(id => setClipZoom(id, value))
  const handlePresetChange = (preset: ZoomPreset) => {
    selectedClipIds.forEach(id => {
      setClipZoomPreset(id, preset)
      if (preset !== 'none' && (clipZooms[id] ?? 1) === 1) setClipZoom(id, 1.5)
    })
  }
  const handleTransitionChange = (value: number) =>
    selectedClipIds.forEach(id => setClipTransitionDuration(id, value))

  // ── Color correction ────────────────────────────────────────────────────────
  const primaryClipId = selectedClipIds[0] ?? null
  const currentColor: ColorCorrection = primaryClipId
    ? (clipColorCorrections[primaryClipId] ?? COLOR_CORRECTION_DEFAULT)
    : COLOR_CORRECTION_DEFAULT

  const applyColorToSelected = (cc: ColorCorrection) =>
    selectedClipIds.forEach(id => setClipColorCorrection(id, cc))

  const handleColorSlider = (key: keyof ColorCorrection, value: number) =>
    applyColorToSelected({ ...currentColor, [key]: value })

  const activeColorPreset = COLOR_PRESETS.find(p =>
    Math.abs(p.values.brightness - currentColor.brightness) < 0.01 &&
    Math.abs(p.values.contrast   - currentColor.contrast)   < 0.01 &&
    Math.abs(p.values.saturation - currentColor.saturation) < 0.01 &&
    Math.abs(p.values.hue        - currentColor.hue)        < 0.5
  )?.name ?? null

  const selectedOverlay     = project?.overlayLayers?.find(ol => ol.id === selectedOverlayId) ?? null
  const selectedAudioLayer  = project?.audioLayers?.find(l => l.id === selectedAudioLayerId) ?? null

  const audioMode = !!selectedAudioLayerId

  const actions = audioMode
    ? [
        { label: 'Split',     hint: 'S',  fn: splitAudioLayer,     enabled: true                    },
        { label: 'Cut',       hint: '⌘X', fn: cutAudioLayer,       enabled: true                    },
        { label: 'Copy',      hint: '⌘C', fn: copyAudioLayer,      enabled: true                    },
        { label: 'Paste',     hint: '⌘V', fn: pasteAudioLayer,     enabled: !!audioLayerClipboard   },
        { label: 'Duplicate', hint: '⌘D', fn: duplicateAudioLayer, enabled: true                    },
      ]
    : [
        { label: 'Split',     hint: 'S',  fn: split,     enabled: true           },
        { label: 'Cut',       hint: '⌘X', fn: cut,       enabled: hasSelection   },
        { label: 'Copy',      hint: '⌘C', fn: copy,      enabled: hasSelection   },
        { label: 'Paste',     hint: '⌘V', fn: paste,     enabled: hasClipboard   },
        { label: 'Duplicate', hint: '⌘D', fn: duplicate, enabled: hasSelection   },
        { label: 'Merge',     hint: 'M',  fn: merge,     enabled: canMergeClips  },
      ]

  // ── Color mode ──────────────────────────────────────────────────────────────
  if (showColor) {
    return (
      <div className="flex flex-col border-y border-neutral-800 bg-neutral-900 shrink-0 px-3 py-2 gap-2.5">

        {/* Row 1: back · presets · scope · apply-all */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowColor(false)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors shrink-0"
          >
            ← Back
          </button>
          <div className="w-px h-4 bg-neutral-700 mx-0.5 shrink-0" />

          {/* Preset chips */}
          <div className="flex items-center gap-1 flex-1 flex-wrap">
            {COLOR_PRESETS.map(preset => (
              <button
                key={preset.name}
                onClick={() => applyColorToSelected(preset.values)}
                disabled={!hasSelection}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${
                  activeColorPreset === preset.name
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {hasSelection && (
              <span className="text-[11px] text-neutral-600">
                {selectedClipIds.length} clip{selectedClipIds.length !== 1 ? 's' : ''}
              </span>
            )}
            {!hasSelection && (
              <span className="text-[11px] text-neutral-600">no selection</span>
            )}
            <button
              onClick={() => setAllClipsColorCorrection(currentColor)}
              className="px-2.5 py-1 rounded border border-neutral-700 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-white transition-colors"
            >
              Apply to all
            </button>
          </div>
        </div>

        {/* Row 2: sliders */}
        <div className="flex items-center gap-4">
          {SLIDERS.map(({ key, label, min, max, step, unit }) => {
            const val = currentColor[key]
            const isDefault = val === COLOR_CORRECTION_DEFAULT[key]
            return (
              <div key={key} className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[11px] text-neutral-500 shrink-0 w-[4.5rem]">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={val}
                  disabled={!hasSelection}
                  onChange={e => handleColorSlider(key, parseFloat(e.target.value))}
                  className="flex-1 min-w-0 accent-blue-500 disabled:opacity-40"
                />
                <span className="text-[11px] text-neutral-400 tabular-nums w-10 text-right shrink-0">
                  {val > 0 ? '+' : ''}{key === 'hue' ? `${Math.round(val)}°` : val.toFixed(2)}{unit}
                </span>
                {isDefault
                  ? <span className="w-3 shrink-0" />
                  : (
                    <button
                      onClick={() => handleColorSlider(key, COLOR_CORRECTION_DEFAULT[key])}
                      className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors shrink-0"
                    >
                      ×
                    </button>
                  )
                }
              </div>
            )
          })}
        </div>

      </div>
    )
  }

  // ── Overlay properties mode ─────────────────────────────────────────────────
  if (selectedOverlay) {
    const ol = selectedOverlay
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-y border-neutral-800 bg-neutral-900 shrink-0 overflow-x-auto">
        <button
          onClick={() => setSelectedOverlayId(null)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors shrink-0"
        >
          ← Back
        </button>
        <button
          onClick={() => removeOverlayLayer(ol.id)}
          className="px-2.5 py-1 rounded text-xs text-red-400 hover:bg-red-950 transition-colors shrink-0"
        >
          Delete <span className="text-[10px] text-red-600">⌫</span>
        </button>
        <div className="w-px h-4 bg-neutral-700 shrink-0" />

        {/* Shared: start + duration */}
        <span className="text-[11px] text-neutral-500 shrink-0">Start</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={ol.startAt.toFixed(1)}
          onChange={e => updateOverlayLayer(ol.id, { startAt: Math.max(0, parseFloat(e.target.value) || 0) })}
          className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] text-white tabular-nums"
        />
        <span className="text-[11px] text-neutral-500 shrink-0">Duration</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={ol.duration.toFixed(1)}
          onChange={e => updateOverlayLayer(ol.id, { duration: Math.max(0.5, parseFloat(e.target.value) || 0.5) })}
          className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] text-white tabular-nums"
        />

        <div className="w-px h-4 bg-neutral-700 shrink-0" />

        {ol.type === 'text' && (
          <>
            <input
              type="text"
              value={ol.text ?? ''}
              onChange={e => updateOverlayLayer(ol.id, { text: e.target.value })}
              placeholder="Text…"
              className="w-32 bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-[11px] text-white placeholder-neutral-600"
            />
            <span className="text-[11px] text-neutral-500 shrink-0">Size</span>
            <input
              type="range" min={1} max={20} step={0.5}
              value={ol.fontSize ?? 5}
              onChange={e => updateOverlayLayer(ol.id, { fontSize: parseFloat(e.target.value) })}
              className="w-20 accent-blue-500"
            />
            <span className="text-[11px] text-neutral-400 tabular-nums w-8 shrink-0">{(ol.fontSize ?? 5).toFixed(1)}%</span>
            <button
              onClick={() => updateOverlayLayer(ol.id, { fontWeight: ol.fontWeight === 'bold' ? 'normal' : 'bold' })}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors shrink-0 ${
                ol.fontWeight === 'bold' ? 'bg-blue-600 text-white' : 'text-neutral-400 border border-neutral-700 hover:text-white'
              }`}
            >
              B
            </button>
            <span className="text-[11px] text-neutral-500 shrink-0">Color</span>
            <input
              type="color"
              value={ol.color ?? '#ffffff'}
              onChange={e => updateOverlayLayer(ol.id, { color: e.target.value })}
              className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent"
            />
            <span className="text-[11px] text-neutral-500 shrink-0">BG</span>
            <input
              type="color"
              value={ol.bgColor ?? '#000000'}
              onChange={e => updateOverlayLayer(ol.id, { bgColor: e.target.value })}
              className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent"
            />
            <input
              type="range" min={0} max={1} step={0.05}
              value={ol.bgOpacity ?? 0}
              onChange={e => updateOverlayLayer(ol.id, { bgOpacity: parseFloat(e.target.value) })}
              className="w-16 accent-blue-500"
            />
          </>
        )}

        {ol.type === 'image' && (
          <>
            <span className="text-[11px] text-neutral-500 shrink-0">Width</span>
            <input
              type="range" min={5} max={100} step={1}
              value={ol.width}
              onChange={e => updateOverlayLayer(ol.id, { width: parseFloat(e.target.value) })}
              className="w-24 accent-blue-500"
            />
            <span className="text-[11px] text-neutral-400 tabular-nums w-8 shrink-0">{ol.width}%</span>
            <span className="text-[11px] text-neutral-500 shrink-0">Opacity</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={ol.opacity}
              onChange={e => updateOverlayLayer(ol.id, { opacity: parseFloat(e.target.value) })}
              className="w-20 accent-blue-500"
            />
            <span className="text-[11px] text-neutral-400 tabular-nums w-8 shrink-0">{Math.round(ol.opacity * 100)}%</span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {([
            { label: 'Cut',       hint: '⌘X', fn: cutOverlayLayer,       enabled: true              },
            { label: 'Copy',      hint: '⌘C', fn: copyOverlayLayer,      enabled: true              },
            { label: 'Paste',     hint: '⌘V', fn: pasteOverlayLayer,     enabled: !!overlayClipboard },
            { label: 'Duplicate', hint: '⌘D', fn: duplicateOverlayLayer, enabled: true              },
          ]).map(({ label, hint, fn, enabled }) => (
            <button
              key={label}
              onClick={fn}
              disabled={!enabled}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                enabled
                  ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                  : 'text-neutral-600 cursor-not-allowed'
              }`}
            >
              {label}
              <span className={`text-[10px] ${enabled ? 'text-neutral-500' : 'text-neutral-700'}`}>{hint}</span>
            </button>
          ))}
          <div className="w-px h-4 bg-neutral-700 mx-0.5" />
          <button
            onClick={() => removeOverlayLayer(ol.id)}
            className="px-2.5 py-1 rounded text-xs text-red-400 hover:bg-red-950 transition-colors"
          >
            Delete <span className="text-[10px] text-red-600">⌫</span>
          </button>
        </div>
      </div>
    )
  }

  // ── Normal mode ─────────────────────────────────────────────────────────────
  return (
    <div className="flex items-center gap-px px-3 py-2 border-y border-neutral-800 bg-neutral-900 shrink-0">
      {actions.map(({ label, hint, fn, enabled }) => (
        <button
          key={label}
          onClick={fn}
          disabled={!enabled}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
            ${enabled
              ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
              : 'text-neutral-600 cursor-not-allowed'
            }`}
        >
          {label}
          <span className={`text-[10px] ${enabled ? 'text-neutral-500' : 'text-neutral-700'}`}>
            {hint}
          </span>
        </button>
      ))}

      <div className="w-px h-4 bg-neutral-700 mx-1" />

      <button
        onClick={() => setShowColor(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors text-neutral-300 hover:bg-neutral-700 hover:text-white"
      >
        Color
      </button>

      <div className="w-px h-4 bg-neutral-700 mx-1" />

      <button
        onClick={
          selectedOverlayId ? () => removeOverlayLayer(selectedOverlayId) :
          audioMode         ? () => removeAudioLayer(selectedAudioLayerId!) :
          deleteSelected
        }
        disabled={!selectedOverlayId && !audioMode && !hasSelection}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
          ${selectedOverlayId || audioMode || hasSelection
            ? 'text-neutral-400 hover:bg-red-950 hover:text-red-400'
            : 'text-neutral-600 cursor-not-allowed'
          }`}
      >
        Delete
        <span className={`text-[10px] ${selectedOverlayId || audioMode || hasSelection ? 'text-neutral-500' : 'text-neutral-700'}`}>⌫</span>
      </button>

      {audioMode && (
        <>
          <span className="ml-2 text-[11px] text-emerald-600 font-medium">Audio selected</span>
          {selectedAudioLayer && (
            <>
              <div className="w-px h-4 bg-neutral-700 mx-1" />
              <span className="text-[11px] text-neutral-500 shrink-0">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selectedAudioLayer.volume ?? 1}
                onChange={e => updateAudioLayer(selectedAudioLayer.id, { volume: parseFloat(e.target.value) })}
                className="w-24 accent-emerald-500"
              />
              <span className="text-[11px] text-neutral-400 tabular-nums w-8">
                {Math.round((selectedAudioLayer.volume ?? 1) * 100)}%
              </span>
            </>
          )}
        </>
      )}

      {!audioMode && selectedClipIds.length === 1 && (
        <>
          <div className="w-px h-4 bg-neutral-700 mx-1" />
          <button
            onClick={() => detachAudio(selectedClipIds[0])}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors text-neutral-300 hover:bg-neutral-700 hover:text-white"
          >
            Detach Audio
          </button>
        </>
      )}

      {!audioMode && hasSelection && (
        <>
          <div className="w-px h-4 bg-neutral-700 mx-1" />
          <div className="flex items-center gap-2 px-2">
            <span className="text-[11px] text-neutral-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={avgZoom}
              onChange={e => handleZoomChange(parseFloat(e.target.value))}
              className="w-24 accent-blue-500"
            />
            <span className="text-[11px] text-neutral-400 tabular-nums w-8">{avgZoom.toFixed(2)}×</span>
            {avgZoom !== 1 && (
              <button
                onClick={() => handleZoomChange(1)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                reset
              </button>
            )}
          </div>

          <div className="w-px h-4 bg-neutral-700 mx-1" />

          <div className="flex items-center gap-1 px-1">
            {([
              { value: 'none',      label: 'Static'    },
              { value: 'punch',     label: 'In / Out'  },
              { value: 'ken-burns', label: 'Ken Burns' },
            ] as { value: ZoomPreset; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handlePresetChange(value)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  activeZoomPreset === value
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeZoomPreset === 'punch' && (
            <>
              <div className="w-px h-4 bg-neutral-700 mx-1" />
              <div className="flex items-center gap-2 px-2">
                <span className="text-[11px] text-neutral-500">Transition</span>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={avgTransition}
                  onChange={e => handleTransitionChange(parseFloat(e.target.value))}
                  className="w-20 accent-blue-500"
                />
                <span className="text-[11px] text-neutral-400 tabular-nums w-8">{avgTransition.toFixed(1)}s</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
