'use client'

import { useRef, useState, useEffect } from 'react'
import { useEditorStore } from '@/store/store'
import { getClipTimings } from '@/lib/clipUtils'
import { generateSpeech, warmUpTTS, TTS_VOICES, TtsVoice } from '@/lib/tts'
import { Step, AudioLayer } from '@/types'

type AiAction = 'fix' | 'improve' | 'readable' | 'custom'

const AI_ACTIONS: { id: AiAction; label: string; hint: string }[] = [
  { id: 'fix',       label: 'Fix',       hint: 'Fix grammar and spelling' },
  { id: 'improve',   label: 'Improve',   hint: 'Make it more engaging' },
  { id: 'readable',  label: 'Readable',  hint: 'Make it flow naturally when spoken' },
]

const EMPTY_STEPS: Step[] = []
const EMPTY_CLIPS: import('@/types').Clip[] = []

function stepPosition(step: Step, timings: ReturnType<typeof getClipTimings>): number {
  if (step.timelinePosition !== undefined) return step.timelinePosition
  return timings.find(t => t.clip.id === step.clipId)?.start ?? 0
}

function GripIcon() {
  return (
    <svg className="w-3 h-4 text-neutral-600" viewBox="0 0 8 12" fill="currentColor">
      <circle cx="2" cy="2"  r="1.1" />
      <circle cx="6" cy="2"  r="1.1" />
      <circle cx="2" cy="6"  r="1.1" />
      <circle cx="6" cy="6"  r="1.1" />
      <circle cx="2" cy="10" r="1.1" />
      <circle cx="6" cy="10" r="1.1" />
    </svg>
  )
}

export default function StepsPanel({ projectId }: { projectId: string }) {
  const steps        = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.steps ?? EMPTY_STEPS)
  const clips        = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.clips ?? EMPTY_CLIPS)
  const clipSpeeds   = useEditorStore(s => s.clipSpeeds)
  const playhead     = useEditorStore(s => s.playheadTime)
  const setPlayhead  = useEditorStore(s => s.setPlayhead)
  const updateStep   = useEditorStore(s => s.updateStep)
  const reorderSteps  = useEditorStore(s => s.reorderSteps)
  const addStep       = useEditorStore(s => s.addStep)
  const removeStep    = useEditorStore(s => s.removeStep)
  const addAudioLayer = useEditorStore(s => s.addAudioLayer)

  const [dragIdx,     setDragIdx]     = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [generateProgress, setGenerateProgress] = useState<{ current: number; total: number } | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [voice, setVoice] = useState<TtsVoice>('af_heart')
  const dragFromHandle = useRef(false)

  // Copy/paste state
  const [stepClipboard, setStepClipboard] = useState<{ title: string; description: string } | null>(null)
  const [copyMenuId,    setCopyMenuId]    = useState<string | null>(null)
  const copyMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!copyMenuId) return
    const onMouseDown = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) setCopyMenuId(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [copyMenuId])

  function copyStep(step: Step, withVoiceover: boolean) {
    setStepClipboard({ title: step.title, description: withVoiceover ? step.description : '' })
    setCopyMenuId(null)
  }

  function pasteStep() {
    if (!stepClipboard || steps.length >= 20) return
    const position = positions[activeIdx] + 0.1
    addStep(projectId, {
      id: crypto.randomUUID(),
      clipId: steps[activeIdx]?.clipId ?? '',
      sourceId: steps[activeIdx]?.sourceId ?? '',
      title: stepClipboard.title,
      description: stepClipboard.description,
      timelinePosition: position,
    })
  }

  // Voiceover dropdown state
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false)
  const voiceMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!voiceMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (voiceMenuRef.current && !voiceMenuRef.current.contains(e.target as Node)) setVoiceMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [voiceMenuOpen])

  // More menu state
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [moreMenuOpen])

  function copyAllTitles() {
    const text = steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
    navigator.clipboard.writeText(text)
    setMoreMenuOpen(false)
  }

  function copyAllWithVoiceover() {
    const text = steps.map((s, i) => `${i + 1}. ${s.title}${s.description ? `\n${s.description}` : ''}`).join('\n\n')
    navigator.clipboard.writeText(text)
    setMoreMenuOpen(false)
  }

  function resetSteps() {
    if (!confirm('Clear all voiceover scripts? This cannot be undone.')) return
    steps.forEach(s => updateStep(projectId, s.id, { description: '' }))
    setMoreMenuOpen(false)
  }

  function buildStepsHtml(title: string): string {
    const body = steps.map((s, i) => `
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#666">Step ${i + 1}</p>
        <p style="margin:0 0 6px;font-size:16px;font-weight:600">${s.title || '(Untitled)'}</p>
        ${s.description ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#333">${s.description.replace(/\n/g, '<br>')}</p>` : ''}
      </div>`).join('')
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:sans-serif;max-width:720px;margin:40px auto;color:#111}h1{font-size:20px;margin:0 0 28px}hr{border:none;border-top:1px solid #e5e5e5;margin:28px 0}@media print{body{margin:24px}}</style>
      </head><body><h1>${title}</h1><hr>${body}</body></html>`
  }

  function downloadAsPdf() {
    const html = buildStepsHtml(projectName || 'Steps')
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.onload = () => { win.print() }
    setMoreMenuOpen(false)
  }

  function downloadAsDoc() {
    const html = buildStepsHtml(projectName || 'Steps')
    const blob = new Blob([html], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(projectName || 'steps').replace(/\s+/g, '-').toLowerCase()}-steps.doc`
    a.click()
    URL.revokeObjectURL(url)
    setMoreMenuOpen(false)
  }

  // AI script state
  const [aiOpenId,     setAiOpenId]     = useState<string | null>(null)
  const [aiLoadingId,  setAiLoadingId]  = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showCustom,   setShowCustom]   = useState(false)
  const aiDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aiOpenId) return
    const onMouseDown = (e: MouseEvent) => {
      if (aiDropdownRef.current && !aiDropdownRef.current.contains(e.target as Node)) {
        setAiOpenId(null)
        setShowCustom(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [aiOpenId])

  const projectName = useEditorStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name ?? '')

  async function handleAiAction(step: Step, action: AiAction, prompt?: string) {
    if (aiLoadingId) return
    setAiLoadingId(step.id)
    try {
      const res = await fetch('/api/ai/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          currentText: step.description,
          stepTitle: step.title,
          projectName,
          allStepTitles: steps.map(s => s.title),
          customPrompt: prompt,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`AI request failed: ${res.status} ${JSON.stringify(body)}`)
      }
      const { text } = await res.json()
      if (text) updateStep(projectId, step.id, { description: text })
    } catch (err) {
      console.error('AI script error:', err)
    } finally {
      setAiLoadingId(null)
      setShowCustom(false)
      setCustomPrompt('')
    }
  }

  if (!steps.length) return null

  const timings   = getClipTimings(clips, clipSpeeds)
  const positions = steps.map(s => stepPosition(s, timings))

  let activeIdx = 0
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] <= playhead) activeIdx = i
  }

  async function handleGenerateAll(voiceOverride?: TtsVoice) {
    if (generatingId) return
    const selectedVoice = voiceOverride ?? voice
    const eligible = steps.map((s, i) => ({ step: s, idx: i })).filter(({ step }) => step.description.trim())
    if (!eligible.length) return
    try {
      setModelLoading(true)
      warmUpTTS()
      setGenerateProgress({ current: 0, total: eligible.length })
      for (let i = 0; i < eligible.length; i++) {
        const { step, idx } = eligible[i]
        setGeneratingId(step.id)
        setGenerateProgress({ current: i + 1, total: eligible.length })
        const blob      = await generateSpeech(step.description, selectedVoice)
        const duration  = blob.size / 2 / 24000
        const objectUrl = URL.createObjectURL(blob)
        const layer: AudioLayer = {
          id: crypto.randomUUID(),
          name: step.title || `Step ${idx + 1} voiceover`,
          fileName: `voiceover-step-${idx + 1}.wav`,
          objectUrl,
          duration,
          volume: 1,
          startAt: positions[idx],
          trimStart: 0,
          trimEnd: duration,
        }
        addAudioLayer(layer)
      }
    } catch (err) {
      console.error('TTS error:', err)
    } finally {
      setGeneratingId(null)
      setGenerateProgress(null)
      setModelLoading(false)
    }
  }

  return (
    <div className="border-r border-neutral-800 flex flex-col overflow-hidden bg-neutral-950 shrink-0" style={{ width: '30%' }}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-neutral-800 shrink-0 flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider">Steps</p>
        <div className="flex items-center gap-1.5">
          {stepClipboard && (
            <button
              onClick={pasteStep}
              disabled={steps.length >= 20}
              title={`Paste "${stepClipboard.title}"${stepClipboard.description ? ' (with voiceover)' : ' (title only)'}`}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Paste
            </button>
          )}
          <button
            disabled={steps.length >= 20}
            onClick={() => {
              const pos = positions[activeIdx] + 0.1
              addStep(projectId, {
                id: crypto.randomUUID(),
                clipId: steps[activeIdx]?.clipId ?? '',
                sourceId: steps[activeIdx]?.sourceId ?? '',
                title: `Step ${steps.length + 1}`,
                description: '',
                timelinePosition: pos,
              })
            }}
            title="Add step"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            + Add step
          </button>
          {/* Voiceover dropdown */}
          <div className="relative" ref={voiceMenuRef}>
            <button
              disabled={!steps.some(s => s.description.trim()) || !!generatingId}
              onClick={() => setVoiceMenuOpen(v => !v)}
              className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors ${
                steps.some(s => s.description.trim()) && !generatingId
                  ? 'text-violet-400 hover:text-violet-300 hover:bg-violet-950/50 border border-violet-900 hover:border-violet-700'
                  : 'text-neutral-700 border border-neutral-800 cursor-not-allowed'
              }`}
            >
              {generatingId ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full border border-violet-500 border-t-transparent animate-spin shrink-0" />
                  {modelLoading ? 'Loading…' : generateProgress ? `${generateProgress.current}/${generateProgress.total}` : 'Generating…'}
                </>
              ) : (
                <>
                  <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
                  </svg>
                  Voiceover
                  <svg className={`w-2.5 h-2.5 shrink-0 transition-transform ${voiceMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </button>
            {voiceMenuOpen && !generatingId && (
              <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                {TTS_VOICES.map(v => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setVoice(v.id)
                      setVoiceMenuOpen(false)
                      handleGenerateAll(v.id)
                    }}
                    className={`w-full text-left px-3 py-2 text-[11px] transition-colors flex items-center justify-between ${
                      voice === v.id ? 'text-violet-300 bg-violet-950/40' : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    {v.label}
                    {voice === v.id && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* More menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setMoreMenuOpen(v => !v)}
              title="More options"
              className="p-1 rounded text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              </svg>
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                <button onClick={copyAllTitles} className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors">
                  Copy step titles
                </button>
                <button onClick={copyAllWithVoiceover} className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors">
                  Copy with voiceover
                </button>
                <div className="h-px bg-neutral-800 mx-2 my-0.5" />
                <p className="px-3 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-600">Download</p>
                <button onClick={downloadAsPdf} className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-3 h-3 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  PDF
                </button>
                <button onClick={downloadAsDoc} className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-3 h-3 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  Word Doc
                </button>
                <div className="h-px bg-neutral-800 mx-2 my-0.5" />
                <button onClick={resetSteps} className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-neutral-800 hover:text-red-300 transition-colors">
                  Reset voiceover scripts
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {steps.map((step, i) => {
          const isActive  = i === activeIdx
          const isDragged = dragIdx === i
          const isTarget  = dragOverIdx === i && dragIdx !== null && dragIdx !== i

          return (
            <div
              key={step.id}
              draggable
              onDragStart={e => {
                if (!dragFromHandle.current) { e.preventDefault(); return }
                setDragIdx(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }}
              onDrop={e => {
                e.preventDefault()
                if (dragIdx !== null && dragIdx !== i) reorderSteps(projectId, dragIdx, i)
                setDragIdx(null); setDragOverIdx(null)
              }}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              onClick={() => setPlayhead(positions[i])}
              className={`flex gap-2 px-3 py-3.5 border-b border-neutral-800/50 cursor-pointer transition-all ${
                isDragged ? 'opacity-40' :
                isTarget  ? 'border-t-2 border-t-blue-500' :
                isActive  ? 'bg-neutral-800/40' :
                             'hover:bg-neutral-900/60'
              }`}
            >
              {/* Drag handle */}
              <div
                className="shrink-0 flex items-center pt-0.5 cursor-grab active:cursor-grabbing hover:text-neutral-400 transition-colors"
                onMouseDown={() => { dragFromHandle.current = true }}
                onMouseUp={() => { dragFromHandle.current = false }}
                onClick={e => e.stopPropagation()}
              >
                <GripIcon />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isActive ? 'text-blue-400' : 'text-neutral-600'
                  }`}>
                    Step {i + 1}
                  </p>

                  {/* Copy menu */}
                  <div className="relative" ref={copyMenuId === step.id ? copyMenuRef : undefined} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setCopyMenuId(copyMenuId === step.id ? null : step.id)}
                      title="Copy step"
                      className="text-neutral-700 hover:text-neutral-400 transition-colors"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    </button>
                    {copyMenuId === step.id && (
                      <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                        <button
                          onClick={() => copyStep(step, true)}
                          className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
                        >
                          Copy with voiceover
                        </button>
                        <button
                          onClick={() => copyStep(step, false)}
                          className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
                        >
                          Copy title only
                        </button>
                        <div className="h-px bg-neutral-800 mx-2" />
                        <button
                          onClick={() => { removeStep(projectId, step.id); setCopyMenuId(null) }}
                          className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-neutral-800 hover:text-red-300 transition-colors"
                        >
                          Delete step
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={step.title}
                  onChange={e => updateStep(projectId, step.id, { title: e.target.value })}
                  onClick={e => e.stopPropagation()}
                  onFocus={() => setPlayhead(positions[i])}
                  placeholder="Step title…"
                  className="w-full bg-transparent text-sm font-medium text-neutral-100 placeholder:text-neutral-700 focus:outline-none mb-2 block"
                />

                <textarea
                  value={step.description}
                  onChange={e => updateStep(projectId, step.id, { description: e.target.value.slice(0, 1000) })}
                  onClick={e => e.stopPropagation()}
                  onFocus={() => setPlayhead(positions[i])}
                  placeholder="Voiceover script…"
                  maxLength={1000}
                  rows={3}
                  className="w-full bg-transparent text-xs text-neutral-400 placeholder:text-neutral-700 resize-none focus:outline-none leading-relaxed block"
                />
                <p className={`text-right text-[9px] mt-0.5 ${step.description.length >= 1000 ? 'text-red-500' : 'text-neutral-700'}`}>
                  {step.description.length}/1000
                </p>

                {/* AI enhance dropdown */}
                <div
                  className="relative mt-2"
                  onClick={e => e.stopPropagation()}
                  ref={aiOpenId === step.id ? aiDropdownRef : undefined}
                >
                  {aiLoadingId === step.id ? (
                    <span className="flex items-center gap-1.5 text-[10px] text-violet-400">
                      <span className="w-2.5 h-2.5 rounded-full border border-violet-500 border-t-transparent animate-spin shrink-0" />
                      Rewriting…
                    </span>
                  ) : (
                    <button
                      disabled={!step.description.trim() || !!aiLoadingId}
                      onClick={() => {
                        if (aiOpenId === step.id) { setAiOpenId(null); setShowCustom(false) }
                        else { setAiOpenId(step.id); setShowCustom(false); setCustomPrompt('') }
                      }}
                      className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:border-violet-800 hover:text-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
                      </svg>
                      Enhance Content
                      <svg className={`w-2.5 h-2.5 shrink-0 transition-transform ${aiOpenId === step.id ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}

                  {aiOpenId === step.id && !aiLoadingId && (
                    <div className="absolute left-0 top-full mt-1 z-20 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                      {AI_ACTIONS.map(a => (
                        <button
                          key={a.id}
                          title={a.hint}
                          onClick={() => { setAiOpenId(null); handleAiAction(step, a.id) }}
                          className="w-full text-left px-3 py-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
                        >
                          {a.label}
                        </button>
                      ))}
                      <div className="h-px bg-neutral-800 mx-2" />
                      <button
                        onClick={() => setShowCustom(v => !v)}
                        className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${
                          showCustom ? 'text-violet-300 bg-neutral-800' : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                        }`}
                      >
                        Custom prompt…
                      </button>
                      {showCustom && (
                        <div className="px-2 pb-2 flex gap-1.5">
                          <input
                            autoFocus
                            type="text"
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && customPrompt.trim()) { setAiOpenId(null); handleAiAction(step, 'custom', customPrompt.trim()) }
                              if (e.key === 'Escape') { setShowCustom(false); setAiOpenId(null) }
                            }}
                            placeholder="e.g. make it friendlier…"
                            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[10px] text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-violet-700"
                          />
                          <button
                            disabled={!customPrompt.trim()}
                            onClick={() => { setAiOpenId(null); handleAiAction(step, 'custom', customPrompt.trim()) }}
                            className="text-[10px] px-2 py-1 rounded bg-violet-800 hover:bg-violet-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Go
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
