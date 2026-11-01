'use client'

import { useState, useRef, useLayoutEffect } from 'react'
import { useEditorStore, ZoomPreset, TransitionType } from '@/store/store'
import { COLOR_PRESETS, COLOR_CORRECTION_DEFAULT, ColorCorrection } from '@/lib/colorPresets'
import { canMerge } from '@/lib/clipUtils'

const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none',         label: 'None'    },
  { value: 'fade',         label: 'Fade'    },
  { value: 'slide-left',   label: '← Slide' },
  { value: 'slide-right',  label: '→ Slide' },
  { value: 'slide-top',    label: '↑ Slide' },
  { value: 'slide-bottom', label: '↓ Slide' },
  { value: 'blur',         label: 'Blur'    },
]

const SLIDERS: { key: keyof ColorCorrection; label: string; min: number; max: number; step: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -1,   max: 1,   step: 0.05 },
  { key: 'contrast',   label: 'Contrast',   min: -1,   max: 1,   step: 0.05 },
  { key: 'saturation', label: 'Saturation', min: -1,   max: 1,   step: 0.05 },
  { key: 'hue',        label: 'Hue',        min: -180, max: 180, step: 1    },
]

interface Props {
  /** Fixed viewport X for the popover anchor */
  anchorX: number
  /** Fixed viewport Y (top edge) for the popover */
  anchorY: number
}

export default function ClipPopover({ anchorX, anchorY }: Props) {
  const [zoomDrop,       setZoomDrop]       = useState(false)
  const [transitionDrop, setTransitionDrop] = useState(false)
  const [transitionTab,  setTransitionTab]  = useState<'in' | 'out'>('in')
  const [colorDrop,      setColorDrop]      = useState(false)
  const [subPos,         setSubPos]         = useState({ top: 0, left: 0 })
  const [left,           setLeft]           = useState(anchorX)

  const barRef           = useRef<HTMLDivElement>(null)
  const scrollItemsRef   = useRef<HTMLDivElement>(null)
  const zoomBtnRef       = useRef<HTMLButtonElement>(null)
  const transitionBtnRef = useRef<HTMLButtonElement>(null)
  const colorBtnRef      = useRef<HTMLButtonElement>(null)

  // Clamp popover to viewport after every anchor change
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const w = el.offsetWidth
    const raw = anchorX - w / 2
    setLeft(Math.max(8, Math.min(raw, window.innerWidth - w - 8)))
  }, [anchorX])

  function openSub(ref: React.RefObject<HTMLButtonElement | null>, opener: () => void) {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setSubPos({ top: rect.bottom + 4, left: rect.left })
    opener()
  }

  const selectedClipIds        = useEditorStore(s => s.selectedClipIds)
  const clipboard               = useEditorStore(s => s.clipboard)
  const activeProjectId         = useEditorStore(s => s.activeProjectId)
  const projects                = useEditorStore(s => s.projects)
  const clipZooms               = useEditorStore(s => s.clipZooms)
  const clipZoomPresets         = useEditorStore(s => s.clipZoomPresets)
  const clipTransitionDurations = useEditorStore(s => s.clipTransitionDurations)
  const clipTransitionIn        = useEditorStore(s => s.clipTransitionIn)
  const clipTransitionOut       = useEditorStore(s => s.clipTransitionOut)
  const clipColorCorrections    = useEditorStore(s => s.clipColorCorrections)
  const clipSpeeds              = useEditorStore(s => s.clipSpeeds)

  const setClipSpeed              = useEditorStore(s => s.setClipSpeed)
  const setClipZoom               = useEditorStore(s => s.setClipZoom)
  const setClipZoomPreset         = useEditorStore(s => s.setClipZoomPreset)
  const setClipTransitionDuration = useEditorStore(s => s.setClipTransitionDuration)
  const setClipTransitionIn       = useEditorStore(s => s.setClipTransitionIn)
  const setClipTransitionOut      = useEditorStore(s => s.setClipTransitionOut)
  const setClipColorCorrection    = useEditorStore(s => s.setClipColorCorrection)
  const setAllClipsColorCorrection = useEditorStore(s => s.setAllClipsColorCorrection)

  const split              = useEditorStore(s => s.split)
  const cut                = useEditorStore(s => s.cut)
  const copy               = useEditorStore(s => s.copy)
  const paste              = useEditorStore(s => s.paste)
  const duplicate          = useEditorStore(s => s.duplicate)
  const deleteSelected     = useEditorStore(s => s.deleteSelected)
  const detachAudio        = useEditorStore(s => s.detachAudio)
  const requestFreezeFrame = useEditorStore(s => s.requestFreezeFrame)

  const project      = projects.find(p => p.id === activeProjectId) ?? null
  const hasClipboard = clipboard.length > 0

  // ── Zoom ────────────────────────────────────────────────────────────────────
  const avgZoom = selectedClipIds.length > 0
    ? selectedClipIds.map(id => clipZooms[id] ?? 1).reduce((a, b) => a + b, 0) / selectedClipIds.length
    : 1
  const selectedPresets  = selectedClipIds.map(id => clipZoomPresets[id] ?? 'none')
  const activeZoomPreset: ZoomPreset | 'mixed' = selectedPresets.every(p => p === selectedPresets[0])
    ? selectedPresets[0] ?? 'none' : 'mixed'
  const handleZoomChange  = (v: number) => selectedClipIds.forEach(id => setClipZoom(id, v))
  const handlePresetChange = (preset: ZoomPreset) => {
    selectedClipIds.forEach(id => {
      setClipZoomPreset(id, preset)
      if (preset !== 'none' && (clipZooms[id] ?? 1) === 1) setClipZoom(id, 1.5)
    })
  }

  // ── Transitions ─────────────────────────────────────────────────────────────
  const avgTransition = selectedClipIds.length > 0
    ? selectedClipIds.map(id => clipTransitionDurations[id] ?? 0.5).reduce((a, b) => a + b, 0) / selectedClipIds.length
    : 0.5
  const handleTransitionChange     = (v: number)          => selectedClipIds.forEach(id => setClipTransitionDuration(id, v))
  const handleTransitionInChange   = (t: TransitionType)  => selectedClipIds.forEach(id => setClipTransitionIn(id, t))
  const handleTransitionOutChange  = (t: TransitionType)  => selectedClipIds.forEach(id => setClipTransitionOut(id, t))

  const primaryId           = selectedClipIds[0] ?? null
  const primaryTransIn      = primaryId ? (clipTransitionIn[primaryId]  ?? 'none') : 'none'
  const primaryTransOut     = primaryId ? (clipTransitionOut[primaryId] ?? 'none') : 'none'
  const hasClipTransition   = primaryTransIn !== 'none' || primaryTransOut !== 'none'

  // ── Speed ────────────────────────────────────────────────────────────────────
  const speeds     = selectedClipIds.map(id => clipSpeeds[id] ?? 1)
  const activeSpeed: number | 'mixed' = speeds.every(s => s === speeds[0]) ? speeds[0] ?? 1 : 'mixed'
  const handleSpeedChange = (s: number) => selectedClipIds.forEach(id => setClipSpeed(id, s))

  // ── Color ────────────────────────────────────────────────────────────────────
  const currentColor: ColorCorrection = primaryId
    ? (clipColorCorrections[primaryId] ?? COLOR_CORRECTION_DEFAULT)
    : COLOR_CORRECTION_DEFAULT
  const applyColor       = (cc: ColorCorrection) => selectedClipIds.forEach(id => setClipColorCorrection(id, cc))
  const handleSlider     = (key: keyof ColorCorrection, v: number) => applyColor({ ...currentColor, [key]: v })
  const isDefaultColor   = SLIDERS.every(s => currentColor[s.key] === COLOR_CORRECTION_DEFAULT[s.key])
  const activeColorPreset = COLOR_PRESETS.find(p =>
    Math.abs(p.values.brightness - currentColor.brightness) < 0.01 &&
    Math.abs(p.values.contrast   - currentColor.contrast)   < 0.01 &&
    Math.abs(p.values.saturation - currentColor.saturation) < 0.01 &&
    Math.abs(p.values.hue        - currentColor.hue)        < 0.5
  )?.name ?? null

  const zoomActive = avgZoom !== 1 || activeZoomPreset !== 'none'

  return (
    <>
      {/* Main popover bar */}
      <div
        ref={barRef}
        className="fixed z-[990] bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl flex items-center"
        style={{ top: anchorY, left }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {/* ‹ scroll left */}
        <button
          onClick={() => scrollItemsRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
          className="flex items-center justify-center w-7 h-7 mx-1 rounded-lg bg-neutral-800 hover:bg-neutral-600 text-neutral-300 hover:text-white transition-colors shrink-0 text-lg font-medium"
          aria-label="Scroll left"
        >
          ‹
        </button>

        {/* Scrollable items — shows ~4 options */}
        <div
          ref={scrollItemsRef}
          className="flex items-center gap-px overflow-x-auto py-1"
          style={{ width: 300, scrollbarWidth: 'none' }}
        >
          {/* Split */}
          <Btn onClick={split}>Split <Hint>S</Hint></Btn>

          <Sep />

          {/* Zoom */}
          <button
            ref={zoomBtnRef}
            onClick={() => { openSub(zoomBtnRef, () => { setTransitionDrop(false); setColorDrop(false); setZoomDrop(v => !v) }) }}
            className={popBtnCls(zoomDrop, zoomActive)}
          >
            {zoomActive && <Dot />}Zoom <Chevron />
          </button>

          {/* Transition */}
          <button
            ref={transitionBtnRef}
            onClick={() => { openSub(transitionBtnRef, () => { setZoomDrop(false); setColorDrop(false); setTransitionDrop(v => !v) }) }}
            className={popBtnCls(transitionDrop, hasClipTransition)}
          >
            {hasClipTransition && <Dot />}Transition <Chevron />
          </button>

          <Sep />

          {/* Detach Audio — single clip only */}
          {selectedClipIds.length === 1 && (
            <>
              <Btn onClick={() => detachAudio(selectedClipIds[0])}>Detach Audio</Btn>
              <Sep />
            </>
          )}

          {/* Speed */}
          <select
            value={activeSpeed === 'mixed' ? '' : activeSpeed}
            onChange={e => handleSpeedChange(parseFloat(e.target.value))}
            aria-label="Clip speed"
            className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] text-white cursor-pointer mx-1 shrink-0"
          >
            {activeSpeed === 'mixed' && <option value="">mixed</option>}
            {([0.5, 0.75, 1, 1.5, 2, 4] as const).map(s => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>

          <Sep />

          {/* Color */}
          <button
            ref={colorBtnRef}
            onClick={() => { openSub(colorBtnRef, () => { setZoomDrop(false); setTransitionDrop(false); setColorDrop(v => !v) }) }}
            className={popBtnCls(colorDrop, !isDefaultColor)}
          >
            {!isDefaultColor && <Dot />}Color <Chevron />
          </button>

          <Sep />

          {/* Freeze */}
          <Btn onClick={() => requestFreezeFrame()}>Freeze <Hint>F</Hint></Btn>

          <Sep />

          {/* Duplicate / Cut / Copy / Paste */}
          <Btn onClick={duplicate}>Duplicate <Hint>⌘D</Hint></Btn>
          <Btn onClick={cut}>Cut <Hint>⌘X</Hint></Btn>
          <Btn onClick={copy}>Copy <Hint>⌘C</Hint></Btn>
          <button
            onClick={paste}
            disabled={!hasClipboard}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors disabled:text-neutral-600 disabled:cursor-not-allowed shrink-0"
          >
            Paste <Hint>⌘V</Hint>
          </button>

          <Sep />

          {/* Delete */}
          <button
            onClick={deleteSelected}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-400 hover:bg-red-950 hover:text-red-400 transition-colors shrink-0"
          >
            Delete <span className="text-[10px] text-red-700">⌫</span>
          </button>
        </div>

        {/* › scroll right */}
        <button
          onClick={() => scrollItemsRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
          className="flex items-center justify-center w-7 h-7 mx-1 rounded-lg bg-neutral-800 hover:bg-neutral-600 text-neutral-300 hover:text-white transition-colors shrink-0 text-lg font-medium"
          aria-label="Scroll right"
        >
          ›
        </button>
      </div>

      {/* ── Zoom sub-panel ─────────────────────────────────────────────────── */}
      {zoomDrop && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setZoomDrop(false)} />
          <div
            className="fixed z-[999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-3 w-56 flex flex-col gap-3"
            style={subPos}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">Level</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-neutral-300 tabular-nums">{avgZoom.toFixed(2)}×</span>
                  {avgZoom !== 1 && (
                    <button onClick={() => handleZoomChange(1)} className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors">reset</button>
                  )}
                </div>
              </div>
              <input type="range" min={1} max={3} step={0.05} value={avgZoom}
                onChange={e => handleZoomChange(parseFloat(e.target.value))}
                className="w-full accent-blue-500" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Animation</span>
              <select
                value={activeZoomPreset === 'mixed' ? '' : activeZoomPreset}
                onChange={e => handlePresetChange(e.target.value as ZoomPreset)}
                className="bg-neutral-700 border border-neutral-600 rounded px-1.5 py-0.5 text-[11px] text-white cursor-pointer"
              >
                {activeZoomPreset === 'mixed' && <option value="">mixed</option>}
                <option value="none">Static</option>
                <option value="punch">In / Out</option>
                <option value="ken-burns">Ken Burns</option>
              </select>
            </div>
            {activeZoomPreset === 'punch' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-neutral-400">Duration</span>
                  <span className="text-[11px] text-neutral-300 tabular-nums">{avgTransition.toFixed(1)}s</span>
                </div>
                <input type="range" min={0.1} max={2} step={0.1} value={avgTransition}
                  onChange={e => handleTransitionChange(parseFloat(e.target.value))}
                  className="w-full accent-blue-500" />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Transition sub-panel ───────────────────────────────────────────── */}
      {transitionDrop && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setTransitionDrop(false)} />
          <div
            className="fixed z-[999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-3 w-56"
            style={subPos}
          >
            <div className="flex gap-0.5 mb-3 bg-neutral-900/60 rounded-md p-0.5">
              {(['in', 'out'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setTransitionTab(tab)}
                  className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                    transitionTab === tab ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {tab === 'in' ? 'In' : 'Out'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TRANSITION_OPTIONS.map(opt => {
                const active = transitionTab === 'in' ? primaryTransIn : primaryTransOut
                return (
                  <button
                    key={opt.value}
                    onClick={() => transitionTab === 'in'
                      ? handleTransitionInChange(opt.value)
                      : handleTransitionOutChange(opt.value)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      active === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {hasClipTransition && (
              <>
                <div className="h-px bg-neutral-700 my-3" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-neutral-500 shrink-0">Duration</span>
                  <input type="range" min={0.1} max={2} step={0.1} value={avgTransition}
                    onChange={e => handleTransitionChange(parseFloat(e.target.value))}
                    className="flex-1 min-w-0 accent-blue-500" />
                  <span className="text-[11px] text-neutral-400 tabular-nums w-8 text-right shrink-0">{avgTransition.toFixed(1)}s</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Color sub-panel ────────────────────────────────────────────────── */}
      {colorDrop && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setColorDrop(false)} />
          <div
            className="fixed z-[999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-3 w-72"
            style={subPos}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex flex-wrap gap-1">
                {COLOR_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => applyColor(preset.values)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      activeColorPreset === preset.name
                        ? 'bg-blue-600 text-white'
                        : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setAllClipsColorCorrection(currentColor)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors ml-2 shrink-0"
              >
                Apply all
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {SLIDERS.map(({ key, label, min, max, step }) => {
                const val = currentColor[key]
                const isDefault = val === COLOR_CORRECTION_DEFAULT[key]
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className="text-[11px] text-neutral-500 w-16 shrink-0">{label}</span>
                    <input type="range" min={min} max={max} step={step} value={val}
                      onChange={e => handleSlider(key, parseFloat(e.target.value))}
                      className="flex-1 accent-blue-500" />
                    <span className="text-[11px] text-neutral-400 tabular-nums w-10 text-right shrink-0">
                      {val > 0 ? '+' : ''}{key === 'hue' ? `${Math.round(val)}°` : val.toFixed(2)}
                    </span>
                    {isDefault
                      ? <span className="w-3 shrink-0" />
                      : <button onClick={() => handleSlider(key, COLOR_CORRECTION_DEFAULT[key])} className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors shrink-0">×</button>
                    }
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── Tiny helpers ────────────────────────────────────────────────────────────────

function Btn({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors disabled:text-neutral-600 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 bg-neutral-700 mx-0.5 shrink-0" />
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] text-neutral-500">{children}</span>
}

function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
}

function Chevron() {
  return (
    <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 8 6" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M1 1l3 3 3-3" />
    </svg>
  )
}

function popBtnCls(open: boolean, active: boolean) {
  return `flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
    open
      ? 'bg-neutral-700 border-neutral-500 text-white'
      : active
        ? 'bg-neutral-800 border-blue-600/60 text-white'
        : 'border-transparent text-neutral-300 hover:bg-neutral-700 hover:text-white'
  }`
}
