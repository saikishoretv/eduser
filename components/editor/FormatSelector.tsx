'use client'

import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { FORMAT_PRESETS, FormatPreset, PLATFORMS } from '@/lib/formats'

export default function FormatSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const outputFormat = useEditorStore(s => s.outputFormat)
  const setOutputFormat = useEditorStore(s => s.setOutputFormat)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const label = outputFormat
    ? `${outputFormat.label} · ${outputFormat.aspectW}:${outputFormat.aspectH}`
    : 'Original'

  const select = (preset: FormatPreset | null) => {
    setOutputFormat(preset)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-700 hover:border-neutral-500 text-xs text-neutral-300 hover:text-white transition-colors bg-neutral-900"
      >
        <AspectIcon format={outputFormat} />
        <span>{label}</span>
        <svg className={`w-3 h-3 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 right-0 z-50 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden min-w-52">
          {/* Original */}
          <button
            onClick={() => select(null)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-800 transition-colors ${!outputFormat ? 'text-white' : 'text-neutral-400'}`}
          >
            <span className="w-7 h-7 rounded border border-neutral-600 flex items-center justify-center shrink-0">
              <span className="text-[9px] text-neutral-500">—</span>
            </span>
            <div>
              <p className="text-xs font-medium leading-none">Original</p>
              <p className="text-[10px] text-neutral-500 mt-0.5">No crop</p>
            </div>
          </button>

          <div className="h-px bg-neutral-800" />

          {PLATFORMS.map(platform => (
            <div key={platform}>
              <p className="px-4 py-2 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                {platform}
              </p>
              {FORMAT_PRESETS.filter(p => p.platform === platform).map(preset => (
                <button
                  key={preset.id}
                  onClick={() => select(preset)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-neutral-800 transition-colors ${
                    outputFormat?.id === preset.id ? 'text-white' : 'text-neutral-400'
                  }`}
                >
                  <AspectIcon format={preset} size={28} />
                  <div>
                    <p className="text-xs font-medium leading-none">{preset.label}</p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">{preset.aspectW}:{preset.aspectH}</p>
                  </div>
                  {outputFormat?.id === preset.id && (
                    <svg className="w-3.5 h-3.5 text-blue-400 ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
              {platform !== PLATFORMS[PLATFORMS.length - 1] && <div className="h-px bg-neutral-800" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AspectIcon({ format, size = 24 }: { format: FormatPreset | null; size?: number }) {
  if (!format) {
    return <span style={{ width: size, height: size }} className="rounded border border-neutral-600 shrink-0" />
  }
  const ratio = format.aspectW / format.aspectH
  let w = size, h = size
  if (ratio > 1) h = Math.round(size / ratio)
  else if (ratio < 1) w = Math.round(size * ratio)

  return (
    <span
      style={{ width: size, height: size }}
      className="flex items-center justify-center shrink-0"
    >
      <span
        className="rounded-sm border border-neutral-500 bg-neutral-700"
        style={{ width: w, height: h }}
      />
    </span>
  )
}
