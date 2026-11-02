'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useEditorStore } from '@/store/store'
import { getClipTimings } from '@/lib/clipUtils'
import { Step, SourceVideo } from '@/types'

const EMPTY_STEPS: Step[] = []
const EMPTY_CLIPS: import('@/types').Clip[] = []
const EMPTY_SOURCES: SourceVideo[] = []

interface FrameCapture { dataUrl: string; landscape: boolean }

interface Props { onClose: () => void }

type Tab    = 'steps' | 'header'
type Format = 'pdf' | 'doc'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-neutral-700'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

export default function StepsExportModal({ onClose }: Props) {
  const steps       = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.steps ?? EMPTY_STEPS)
  const clips       = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? EMPTY_CLIPS)
  const sources     = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.sources ?? EMPTY_SOURCES)
  const clipSpeeds  = useEditorStore(s => s.clipSpeeds)
  const projectName = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name ?? '')

  const timings   = useMemo(() => getClipTimings(clips, clipSpeeds), [clips, clipSpeeds])
  const positions = useMemo(() => steps.map(s =>
    s.timelinePosition !== undefined
      ? s.timelinePosition
      : (timings.find(t => t.clip.id === s.clipId)?.start ?? 0)
  ), [steps, timings])

  // ── Tab / format ──
  const [tab, setTab]       = useState<Tab>('steps')
  const [format, setFormat] = useState<Format>('pdf')

  // ── Steps tab ──
  const [withScreenshots, setWithScreenshots] = useState(false)
  const [activeIdx, setActiveIdx]             = useState(0)
  const [stepFrames, setStepFrames]           = useState<Record<string, FrameCapture>>({})
  const [skipped, setSkipped]                 = useState<Set<string>>(new Set())
  const [scrubTime, setScrubTime]             = useState(0)
  const [scrubMin, setScrubMin]               = useState(0)
  const [scrubMax, setScrubMax]               = useState(1)
  const [frameConfirmed, setFrameConfirmed]   = useState(false)

  // ── Header tab ──
  const [headerTitle, setHeaderTitle]       = useState(projectName || 'Steps')
  const [showTitle, setShowTitle]           = useState(true)
  const [headerSubtitle, setHeaderSubtitle] = useState('')
  const [showSubtitle, setShowSubtitle]     = useState(false)
  const [showHeaderDate, setShowHeaderDate] = useState(false)

  // ── Footer tab ──
  const [footerText, setFooterText]         = useState('')
  const [showFooterText, setShowFooterText] = useState(false)
  const [showPageNumbers, setShowPageNumbers] = useState(false)
  const [showFooterDate, setShowFooterDate] = useState(false)

  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const abortRef   = useRef(false)
  const currentSrc = useRef('')

  // ── Helpers ──
  const getStepCtx = useCallback((idx: number) => {
    const pos    = positions[idx]
    const timing = timings.find(t => pos >= t.start && pos < t.end) ?? timings[timings.length - 1]
    if (!timing) return null
    const source = sources.find(s => s.id === timing.clip.sourceId)
    if (!source?.objectUrl || source.isImage) return null
    const speed   = clipSpeeds[timing.clip.id] ?? 1
    const srcTime = timing.clip.trimStart + (pos - timing.start) * speed
    return { timing, source, srcTime }
  }, [timings, positions, sources, clipSpeeds])

  function drawFrame() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const vw = video.videoWidth  || 640
    const vh = video.videoHeight || 360
    const w  = Math.min(vw, 960)
    const h  = Math.round(w * vh / vw)
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')?.drawImage(video, 0, 0, w, h)
  }

  const loadAndSeek = useCallback((src: string, time: number) => {
    const video = videoRef.current
    if (!video) return
    const seekAndDraw = () => {
      video.addEventListener('seeked', drawFrame, { once: true })
      video.currentTime = time
    }
    if (currentSrc.current !== src) {
      currentSrc.current = src
      video.addEventListener('loadedmetadata', seekAndDraw, { once: true })
      video.src = src
      video.load()
    } else {
      seekAndDraw()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-capture all frames when screenshots mode is enabled
  useEffect(() => {
    if (!withScreenshots) return
    abortRef.current = false

    async function captureAll() {
      const video  = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true; video.playsInline = true
      const canvas = document.createElement('canvas')

      for (let i = 0; i < steps.length; i++) {
        if (abortRef.current) break
        const ctx = getStepCtx(i)
        if (!ctx) {
          setStepFrames(prev => ({ ...prev, [steps[i].id]: { dataUrl: '', landscape: true } }))
          continue
        }
        try {
          if (video.src !== ctx.source.objectUrl) {
            await new Promise<void>(resolve => {
              video.addEventListener('loadedmetadata', () => resolve(), { once: true })
              video.src = ctx.source.objectUrl; video.load()
            })
          }
          await new Promise<void>(resolve => {
            video.addEventListener('seeked', () => resolve(), { once: true })
            video.currentTime = ctx.srcTime
          })
          const vw = video.videoWidth || 640; const vh = video.videoHeight || 360
          const landscape = vw >= vh
          const w = Math.min(vw, 960); const h = Math.round(w * vh / vw)
          canvas.width = w; canvas.height = h
          canvas.getContext('2d')?.drawImage(video, 0, 0, w, h)
          if (!abortRef.current)
            setStepFrames(prev => ({ ...prev, [steps[i].id]: { dataUrl: canvas.toDataURL('image/jpeg', 0.85), landscape } }))
        } catch {
          setStepFrames(prev => ({ ...prev, [steps[i].id]: { dataUrl: '', landscape: true } }))
        }
      }
    }
    captureAll()
    return () => { abortRef.current = true }
  }, [withScreenshots]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update right pane when active step changes
  useEffect(() => {
    if (!withScreenshots) return
    const ctx = getStepCtx(activeIdx)
    if (!ctx) return
    setScrubMin(ctx.timing.clip.trimStart)
    setScrubMax(ctx.timing.clip.trimEnd)
    setScrubTime(ctx.srcTime)
    loadAndSeek(ctx.source.objectUrl, ctx.srcTime)
  }, [activeIdx, withScreenshots, getStepCtx, loadAndSeek])

  function handleScrub(time: number) {
    setScrubTime(time)
    const video = videoRef.current
    if (!video) return
    video.addEventListener('seeked', drawFrame, { once: true })
    video.currentTime = time
  }

  function useThisFrame() {
    const canvas = canvasRef.current
    if (!canvas) return
    const landscape = canvas.width >= canvas.height
    setStepFrames(prev => ({
      ...prev,
      [steps[activeIdx].id]: { dataUrl: canvas.toDataURL('image/jpeg', 0.85), landscape },
    }))
    setFrameConfirmed(true)
    setTimeout(() => setFrameConfirmed(false), 1800)
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function todayStr() {
    return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function buildHtml(): string {
    const title = (showTitle ? headerTitle : '') || ''

    const headerHtml = `
      ${showTitle && title ? `<h1 style="font-size:22px;font-weight:700;margin:0 0 6px">${title}</h1>` : ''}
      ${showSubtitle && headerSubtitle ? `<p style="font-size:14px;color:#555;margin:0 0 6px">${headerSubtitle}</p>` : ''}
      ${showHeaderDate ? `<p style="font-size:12px;color:#888;margin:0 0 6px">${todayStr()}</p>` : ''}
      ${(showTitle || showSubtitle || showHeaderDate) ? `<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0">` : ''}
    `

    const footerCss = (showPageNumbers || showFooterText || showFooterDate)
      ? `@page { margin-bottom: 60px } .page-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 40px; font-size: 11px; color: #999; display: flex; justify-content: space-between; border-top: 1px solid #eee; background: white }`
      : ''

    const footerHtml = (showPageNumbers || showFooterText || showFooterDate)
      ? `<div class="page-footer">
          <span>${showFooterText && footerText ? footerText : ''}</span>
          <span>${showFooterDate ? todayStr() : ''}</span>
          ${showPageNumbers ? `<span class="page-num"></span>` : '<span></span>'}
        </div>`
      : ''

    const body = steps.map((s, i) => {
      const shot   = withScreenshots && !skipped.has(s.id) ? stepFrames[s.id] : null
      const imgTag = shot?.dataUrl
        ? shot.landscape
          ? `<img src="${shot.dataUrl}" style="width:80%;height:auto;border-radius:4px;margin-bottom:10px;display:block;border:1px solid #e5e5e5">`
          : `<img src="${shot.dataUrl}" style="width:auto;max-height:370px;border-radius:4px;margin-bottom:10px;display:block;border:1px solid #e5e5e5">`
        : ''
      return `
        <div style="margin-bottom:32px;page-break-inside:avoid">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#666">Step ${i + 1}</p>
          <p style="margin:0 0 8px;font-size:16px;font-weight:600">${s.title || '(Untitled)'}</p>
          ${imgTag}
          ${s.description ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#333">${s.description.replace(/\n/g, '<br>')}</p>` : ''}
        </div>`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title || 'Steps'}</title>
      <style>
        body { font-family: sans-serif; max-width: 720px; margin: 40px auto; color: #111 }
        @media print { body { margin: 24px } img { max-width: 100% !important } }
        ${footerCss}
      </style>
      </head><body>
      ${headerHtml}
      ${footerHtml}
      ${body}
      </body></html>`
  }

  function doExport() {
    const html = buildHtml()
    if (format === 'pdf') {
      const win = window.open('', '_blank')
      if (!win) return
      win.document.write(html)
      win.document.close()
      win.onload = () => win.print()
    } else {
      const blob = new Blob([html], { type: 'application/msword' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `${(headerTitle || projectName || 'steps').replace(/\s+/g, '-').toLowerCase()}-steps.doc`
      a.click()
      URL.revokeObjectURL(url)
    }
    onClose()
  }

  const activeStep  = steps[activeIdx]
  const hasVideoCtx = !!getStepCtx(activeIdx)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'steps',  label: 'Steps'          },
    { id: 'header', label: 'Header & Footer' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
          withScreenshots
            ? 'w-[940px] max-w-[96vw] h-[620px] max-h-[90vh]'
            : 'w-[520px] max-w-[96vw]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Modal header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-white">Export Steps</h2>
            {/* Tabs */}
            <div className="flex items-center gap-0.5">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    tab === t.id ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-neutral-700 text-[11px]">
              {(['pdf', 'doc'] as Format[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-2.5 py-1 transition-colors ${format === f ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}
                >
                  {f === 'pdf' ? 'PDF' : 'Word'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-neutral-500 hover:text-white text-lg leading-none transition-colors">×</button>
          </div>
        </div>

        {/* ── STEPS TAB ── */}
        {tab === 'steps' && (
          <>
            {/* Screenshots toggle bar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-neutral-300 font-medium">Include screenshots</span>
                <span className="text-[10px] text-neutral-600">Pick a video frame per step</span>
              </div>
              <Toggle on={withScreenshots} onChange={setWithScreenshots} />
            </div>

            {withScreenshots ? (
              /* Two-pane picker */
              <div className="flex flex-1 min-h-0">
                {/* Left — step list */}
                <div className="w-56 shrink-0 border-r border-neutral-800 overflow-y-auto">
                  {steps.map((step, i) => {
                    const frame     = stepFrames[step.id]
                    const isSkipped = skipped.has(step.id)
                    const isActive  = i === activeIdx
                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-neutral-800/50 transition-colors ${
                          isActive ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
                        }`}
                      >
                        <button
                          onClick={() => { setActiveIdx(i); setFrameConfirmed(false) }}
                          className="w-16 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center bg-neutral-800 border border-neutral-700"
                        >
                          {isSkipped ? (
                            <span className="text-[9px] text-neutral-600">skip</span>
                          ) : frame === undefined ? (
                            <span className="w-3 h-3 rounded-full border border-neutral-500 border-t-transparent animate-spin" />
                          ) : frame.dataUrl ? (
                            <img src={frame.dataUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.277A1 1 0 0121 8.68v6.64a1 1 0 01-1.447.894L15 14M4 8h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z" />
                            </svg>
                          )}
                        </button>
                        <button onClick={() => { setActiveIdx(i); setFrameConfirmed(false) }} className="flex-1 min-w-0 text-left">
                          <p className={`text-[9px] font-semibold uppercase tracking-wider mb-0.5 ${isActive ? 'text-blue-400' : 'text-neutral-600'}`}>
                            Step {i + 1}
                          </p>
                          <p className="text-[11px] text-neutral-300 truncate">{step.title || '(Untitled)'}</p>
                        </button>
                        <button
                          onClick={() => setSkipped(prev => {
                            const next = new Set(prev)
                            next.has(step.id) ? next.delete(step.id) : next.add(step.id)
                            return next
                          })}
                          title={isSkipped ? 'Include screenshot' : 'Skip screenshot'}
                          className="shrink-0 text-neutral-700 hover:text-neutral-400 transition-colors"
                        >
                          {isSkipped ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Right — frame picker */}
                <div className="flex-1 flex flex-col min-w-0 p-4 gap-3">
                  {activeStep && (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 shrink-0">
                        Step {activeIdx + 1} — {activeStep.title || 'Untitled'}
                      </p>
                      <div className="flex-1 min-h-0 flex items-center justify-center bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800">
                        {hasVideoCtx
                          ? <canvas ref={canvasRef} className="max-w-full max-h-full" />
                          : <p className="text-xs text-neutral-600">No video source for this step</p>
                        }
                      </div>
                      {hasVideoCtx && (
                        <div className="shrink-0 flex flex-col gap-2">
                          <input
                            type="range"
                            min={scrubMin} max={scrubMax} step={1 / 30} value={scrubTime}
                            onChange={e => handleScrub(Number(e.target.value))}
                            className="w-full accent-blue-500"
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-neutral-600 tabular-nums">{fmt(scrubTime - scrubMin)} / {fmt(scrubMax - scrubMin)}</span>
                            <button
                              onClick={useThisFrame}
                              className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                                frameConfirmed ? 'bg-green-700 text-green-100 cursor-default' : 'bg-blue-600 hover:bg-blue-500 text-white'
                              }`}
                            >
                              {frameConfirmed ? '✓ Frame set' : 'Use this frame'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Text-only preview */
              <div className="px-5 py-4 text-xs text-neutral-500">
                {steps.length} step{steps.length !== 1 ? 's' : ''} · titles and voiceover scripts
              </div>
            )}

            <video ref={videoRef} className="hidden" crossOrigin="anonymous" muted playsInline />
          </>
        )}

        {/* ── HEADER & FOOTER TAB ── */}
        {tab === 'header' && (
          <div className="flex flex-col gap-4 p-4 overflow-y-auto">

            {/* Header block */}
            <div className="rounded-xl bg-neutral-800/60 border border-neutral-700 overflow-hidden">
              <p className="px-4 py-2.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-700 bg-neutral-800">
                Header
              </p>
              <div className="divide-y divide-neutral-700/60">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0 mr-4">
                    <span className="text-xs text-neutral-300 font-medium">Title</span>
                    {showTitle && (
                      <input
                        type="text"
                        value={headerTitle}
                        onChange={e => setHeaderTitle(e.target.value)}
                        placeholder="Document title…"
                        className="mt-1.5 w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                  <Toggle on={showTitle} onChange={setShowTitle} />
                </div>

                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0 mr-4">
                    <span className="text-xs text-neutral-300 font-medium">Subtitle</span>
                    {showSubtitle && (
                      <input
                        type="text"
                        value={headerSubtitle}
                        onChange={e => setHeaderSubtitle(e.target.value)}
                        placeholder="e.g. Internal guide · v1.0"
                        className="mt-1.5 w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                  <Toggle on={showSubtitle} onChange={setShowSubtitle} />
                </div>

                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-neutral-300 font-medium">Date</span>
                    <span className="text-[10px] text-neutral-600">{todayStr()}</span>
                  </div>
                  <Toggle on={showHeaderDate} onChange={setShowHeaderDate} />
                </div>
              </div>
            </div>

            {/* Footer block */}
            <div className="rounded-xl bg-neutral-800/60 border border-neutral-700 overflow-hidden">
              <p className="px-4 py-2.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-700 bg-neutral-800">
                Footer
              </p>
              <div className="divide-y divide-neutral-700/60">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0 mr-4">
                    <span className="text-xs text-neutral-300 font-medium">Footer text</span>
                    {showFooterText && (
                      <input
                        type="text"
                        value={footerText}
                        onChange={e => setFooterText(e.target.value)}
                        placeholder="e.g. Confidential · Acme Corp"
                        className="mt-1.5 w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                  <Toggle on={showFooterText} onChange={setShowFooterText} />
                </div>

                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-neutral-300 font-medium">Page numbers</span>
                  <Toggle on={showPageNumbers} onChange={setShowPageNumbers} />
                </div>

                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-neutral-300 font-medium">Date</span>
                    <span className="text-[10px] text-neutral-600">{todayStr()}</span>
                  </div>
                  <Toggle on={showFooterDate} onChange={setShowFooterDate} />
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Modal footer ── */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-neutral-800 shrink-0">
          <button
            onClick={doExport}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            Export {format === 'pdf' ? 'PDF' : 'Word'}
          </button>
        </div>
      </div>
    </div>
  )

}
