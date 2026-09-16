// @ffmpeg/ffmpeg is loaded at runtime via UMD script tag (public/ffmpeg.js)
// to avoid Turbopack/webpack mangling its `new Worker(new URL(..., import.meta.url))` call.
import { Clip, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer } from '@/types'
import { FormatPreset } from '@/lib/formats'
import { SubtitleStyle, TransitionType } from '@/store/store'
import { SubtitleAppearance, StandardSubtitleAppearance } from '@/lib/subtitleTemplates'
import { getClipTimings } from '@/lib/clipUtils'
import { ColorCorrection, COLOR_CORRECTION_DEFAULT, toFfmpegColorFilter } from '@/lib/colorPresets'

export interface ExportOptions {
  clips: Clip[]
  sources: SourceVideo[]
  outputFormat: FormatPreset | null
  clipCrops: Record<string, { x: number; y: number }>
  clipZooms: Record<string, number>
  clipSpeeds: Record<string, number>
  resolution: 720 | 1080
  audioLayers: AudioLayer[]
  overlayLayers: OverlayLayer[]
  clipColorCorrections: Record<string, ColorCorrection>
  clipTransitionIn: Record<string, TransitionType>
  clipTransitionOut: Record<string, TransitionType>
  clipTransitionDurations: Record<string, number>
  subtitleStyle: SubtitleStyle
  subtitleAppearance: SubtitleAppearance
  standardSubtitleAppearance: StandardSubtitleAppearance
  onProgress: (ratio: number) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegInstance: any = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(s)
  })
}

async function fetchFile(input: string | File | Blob): Promise<Uint8Array> {
  const buf: ArrayBuffer = typeof input === 'string'
    ? await fetch(input).then(r => r.arrayBuffer())
    : await input.arrayBuffer()
  return new Uint8Array(buf)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFFmpeg(): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance
  await loadScript('/ffmpeg.js')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { FFmpeg } = (window as any).FFmpegWASM
  const ffmpeg = new FFmpeg()

  // classWorkerURL must be absolute so new URL(s, hardcoded-file-path) in the UMD
  // resolves to the correct URL (absolute URLs ignore the base).
  // ffmpeg-worker.js is a module worker that uses native import() to load the core.
  const base = window.location.origin
  // MT mode (pthreads) deadlocks: pthreads proxy receiveProgress to the module worker
  // thread via Atomics.wait, but that thread is blocked executing _ffmpeg() → deadlock.
  // ST mode runs all encoding synchronously; C→JS callbacks fire during WASM execution
  // and self.postMessage() reaches the parent page normally.
  await ffmpeg.load({
    classWorkerURL: `${base}/ffmpeg-worker.js`,
    coreURL: `${base}/ffmpeg-core-st.js`,
    wasmURL: `${base}/ffmpeg-core-st.wasm`,
  })

  ffmpegInstance = ffmpeg
  return ffmpeg
}

function resetFFmpeg() {
  ffmpegInstance = null
}

// ─── Time formatters ──────────────────────────────────────────────────────────

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

function toSrtTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s % 1) * 1000)
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`
}

function toAssTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.round((s % 1) * 100)
  return `${h}:${pad(m)}:${pad(sec)}.${pad(cs)}`
}

// ─── ASS color helpers ────────────────────────────────────────────────────────
// ASS color format: &HAABBGGRR (AA=alpha, 00=opaque, FF=transparent)

function hexToAssBGR(hex: string): string {
  const r = hex.slice(1, 3).toUpperCase()
  const g = hex.slice(3, 5).toUpperCase()
  const b = hex.slice(5, 7).toUpperCase()
  return `${b}${g}${r}`
}

function hexToAssColor(hex: string, opacity: number): string {
  const alpha = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16).padStart(2, '0').toUpperCase()
  return `&H${alpha}${hexToAssBGR(hex)}`
}

// ─── SRT builder (standard mode) ─────────────────────────────────────────────

function buildStandardSrt(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  timelineOffset: number,
): string {
  let index = 1
  let srt = ''
  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue
    const start = Math.max(seg.start - clipStart, 0) + timelineOffset
    const end = Math.min(seg.end - clipStart, clipEnd - clipStart) + timelineOffset
    srt += `${index++}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${seg.text}\n\n`
  }
  return srt
}

// ─── ASS builder (word-highlight mode) ───────────────────────────────────────

function buildHighlightAss(
  allSegments: { segments: TranscriptSegment[]; clipStart: number; clipEnd: number; timelineOffset: number }[],
  appearance: SubtitleAppearance,
  outW: number,
  outH: number,
): string {
  const activeColor  = hexToAssColor(appearance.highlightColor, 1)
  const inactiveColor = hexToAssColor(appearance.inactiveColor, appearance.inactiveOpacity)
  const bgColor       = hexToAssColor(appearance.bgColor, appearance.bgOpacity)
  const borderStyle   = appearance.bgOpacity > 0 ? 4 : 1
  const outline       = borderStyle === 4 ? 0 : 2
  const fontSize      = Math.round(outH * 0.045)

  let events = ''

  for (const { segments, clipStart, clipEnd, timelineOffset } of allSegments) {
    for (const seg of segments) {
      if (seg.end <= clipStart || seg.start >= clipEnd) continue
      const words = seg.words ?? []
      if (!words.length) continue

      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi]
        if (word.end <= clipStart || word.start >= clipEnd) continue

        const eventStart = Math.max(word.start - clipStart, 0) + timelineOffset
        const eventEnd   = Math.min(word.end - clipStart, clipEnd - clipStart) + timelineOffset

        // 4-word sliding window centred around current word
        const windowStart = Math.max(0, wi - 1)
        const windowEnd   = Math.min(words.length, windowStart + 4)
        const displayWords = words.slice(windowStart, windowEnd)

        const text = displayWords.map((w, di) => {
          const isActive = windowStart + di === wi
          const color = isActive ? activeColor : inactiveColor
          return `{\\1c${color}}${w.word}`
        }).join(' ')

        events += `Dialogue: 0,${toAssTime(eventStart)},${toAssTime(eventEnd)},Default,,0,0,0,,${text}\n`
      }
    }
  }

  if (!events) return ''

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${outW}
PlayResY: ${outH}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${activeColor},${inactiveColor},&H00000000,${bgColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},0,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`
}

// ─── Canvas subtitle rendering (no FFmpeg font dependency) ───────────────────

interface SubEvent {
  startAt: number
  endAt: number
  words: Array<{ word: string; active: boolean }>
}

function buildSubEvents(
  timings: Array<{ clip: Clip; start: number; end: number; index: number }>,
  sources: SourceVideo[],
  style: 'standard' | 'highlight',
  clipSpeeds: Record<string, number>,
): SubEvent[] {
  const events: SubEvent[] = []
  for (const timing of timings) {
    const source = sources.find(s => s.id === timing.clip.sourceId)
    // Use translated transcript when active, fall back to original
    const transcript = source?.translatedTranscript ?? source?.transcript
    if (!transcript?.length) continue
    const speed = clipSpeeds[timing.clip.id] ?? 1
    // Convert source time to timeline time: tl = timing.start + (src - trimStart) / speed
    const toTimeline = (src: number) => timing.start + (src - timing.clip.trimStart) / speed

    for (const seg of transcript) {
      if (seg.end <= timing.clip.trimStart || seg.start >= timing.clip.trimEnd) continue

      if (style === 'standard') {
        // One event per segment — plain text
        events.push({
          startAt: toTimeline(Math.max(seg.start, timing.clip.trimStart)),
          endAt:   toTimeline(Math.min(seg.end,   timing.clip.trimEnd)),
          words: [{ word: seg.text, active: true }],
        })
      } else {
        // Highlight mode: one event per word with a 4-word sliding window (karaoke effect).
        // Uses a 10%-height strip PNG to keep decoded memory manageable (≈830KB each at 1080p).
        const words = seg.words ?? []
        if (!words.length) {
          // No word-level timestamps — fall back to segment-level
          events.push({
            startAt: toTimeline(Math.max(seg.start, timing.clip.trimStart)),
            endAt:   toTimeline(Math.min(seg.end,   timing.clip.trimEnd)),
            words: [{ word: seg.text, active: true }],
          })
          continue
        }
        for (let wi = 0; wi < words.length; wi++) {
          const word = words[wi]
          if (word.end <= timing.clip.trimStart || word.start >= timing.clip.trimEnd) continue
          const windowStart = Math.max(0, wi - 1)
          const windowEnd   = Math.min(words.length, windowStart + 4)
          events.push({
            startAt: toTimeline(Math.max(word.start, timing.clip.trimStart)),
            endAt:   toTimeline(Math.min(word.end,   timing.clip.trimEnd)),
            words: words.slice(windowStart, windowEnd).map((w, di) => ({
              word: w.word,
              active: windowStart + di === wi,
            })),
          })
        }
      }
    }
  }
  return events
}

function subHexRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

async function renderSubEvent(
  event: SubEvent,
  outW: number,
  outH: number,
  stripH: number,
  style: 'standard' | 'highlight',
  stdApp: StandardSubtitleAppearance,
  hlApp: SubtitleAppearance,
): Promise<Uint8Array> {
  // Render into a narrow strip (bottom of frame) to minimise per-image memory in FFmpeg
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = stripH
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, outW, stripH)

  const fontSize = Math.round(outH * 0.045)   // keep font size relative to full frame

  if (style === 'standard') {
    const padY = Math.round(fontSize * 0.2)
    const y = stripH - padY - 1               // baseline keeps background rect within strip
    ctx.font = `500 ${fontSize}px sans-serif`  // font-medium to match preview
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    const text = event.words[0].word
    if (stdApp.bgOpacity > 0) {
      const m = ctx.measureText(text)
      const padX = Math.round(fontSize * 0.4)
      const rx = outW / 2 - m.width / 2 - padX
      const ry = y - fontSize - padY
      const rw = m.width + padX * 2
      const rh = fontSize + padY * 2
      ctx.fillStyle = subHexRgba(stdApp.bgColor, stdApp.bgOpacity)
      ctx.beginPath()
      ctx.roundRect(rx, ry, rw, rh, Math.round(fontSize * 0.15))
      ctx.fill()
    }
    ctx.fillStyle = stdApp.textColor
    ctx.fillText(text, outW / 2, y)
  } else {
    const padY = Math.round(fontSize * 0.25)
    const y = stripH - padY - 1               // baseline keeps background rect within strip
    ctx.font = `bold ${fontSize}px sans-serif`  // font-bold to match preview
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    const spaceW = ctx.measureText(' ').width
    const wordWidths = event.words.map(w => ctx.measureText(w.word).width)
    const totalW = wordWidths.reduce((s, w) => s + w, 0) + spaceW * Math.max(0, event.words.length - 1)
    if (hlApp.bgOpacity > 0) {
      const padX = Math.round(fontSize * 0.5)
      const rx = outW / 2 - totalW / 2 - padX
      const ry = y - fontSize - padY
      const rw = totalW + padX * 2
      const rh = fontSize + padY * 2
      ctx.fillStyle = subHexRgba(hlApp.bgColor, hlApp.bgOpacity)
      ctx.beginPath()
      ctx.roundRect(rx, ry, rw, rh, Math.round(fontSize * 0.3))
      ctx.fill()
    }
    let curX = outW / 2 - totalW / 2
    event.words.forEach((w, i) => {
      ctx.globalAlpha = w.active ? 1 : hlApp.inactiveOpacity
      ctx.fillStyle = w.active ? hlApp.highlightColor : hlApp.inactiveColor
      ctx.fillText(w.word, curX, y)
      ctx.globalAlpha = 1
      curX += wordWidths[i] + (i < event.words.length - 1 ? spaceW : 0)
    })
  }

  const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

// ─── Clip transition filters ──────────────────────────────────────────────────

function applyClipTransitions(
  i: number,
  clipDur: number,
  tIn: TransitionType,
  tOut: TransitionType,
  transDur: number,
  outW: number,
  outH: number,
  filterParts: string[],
): string {
  if (tIn === 'none' && tOut === 'none') return `[trim${i}]`

  let cur = `[trim${i}]`
  const D     = Math.max(0.05, Math.min(transDur, clipDur * 0.45))
  const Df    = D.toFixed(3)
  const CDf   = clipDur.toFixed(3)
  const CDmDf = Math.max(0, clipDur - D).toFixed(3)

  // Fade — FFmpeg built-in fade filter
  if (tIn === 'fade' || tOut === 'fade') {
    const fs: string[] = []
    if (tIn  === 'fade') fs.push(`fade=t=in:st=0:d=${Df}`)
    if (tOut === 'fade') fs.push(`fade=t=out:st=${CDmDf}:d=${Df}`)
    const next = `[trim${i}_fade]`
    filterParts.push(`${cur}${fs.join(',')}${next}`)
    cur = next
  }

  // Blur — gblur toggled via timeline enable (on during transition zone)
  if (tIn === 'blur') {
    const next = `[trim${i}_buri]`
    filterParts.push(`${cur}gblur=sigma=15:enable='lt(t,${Df})'${next}`)
    cur = next
  }
  if (tOut === 'blur') {
    const next = `[trim${i}_buro]`
    filterParts.push(`${cur}gblur=sigma=15:enable='gte(t,${CDmDf})'${next}`)
    cur = next
  }

  // Slides — overlay clip on black background with animated position
  const isSlide = (t: TransitionType) => t.startsWith('slide-')
  if (isSlide(tIn) || isSlide(tOut)) {
    const inX  = tIn  === 'slide-left' ? -outW : tIn  === 'slide-right'  ?  outW : 0
    const inY  = tIn  === 'slide-top'  ? -outH : tIn  === 'slide-bottom' ?  outH : 0
    const outX = tOut === 'slide-left' ? -outW : tOut === 'slide-right'  ?  outW : 0
    const outY = tOut === 'slide-top'  ? -outH : tOut === 'slide-bottom' ?  outH : 0

    const axisExpr = (inOff: number, outOff: number): string => {
      const parts: string[] = []
      if (inOff  !== 0) parts.push(`if(lt(t,${Df}),round(${inOff}*(1-t/${Df})),0)`)
      if (outOff !== 0) parts.push(`if(gte(t,${CDmDf}),round(${outOff}*((t-${CDmDf})/${Df})),0)`)
      return parts.length === 0 ? '0' : parts.join('+')
    }

    const xExpr = axisExpr(inX, outX)
    const yExpr = axisExpr(inY, outY)
    const bgLabel = `[bg_slide_${i}]`
    filterParts.push(`color=c=black:size=${outW}x${outH}:rate=60:duration=${CDf}${bgLabel}`)
    const next = `[trim${i}_slide]`
    filterParts.push(`${bgLabel}${cur}overlay=x='${xExpr}':y='${yExpr}'${next}`)
    cur = next
  }

  return cur
}

// ─── Audio tempo chain (atempo only supports 0.5–2.0, chain for other speeds) ─

function buildAtempoChain(speed: number): string {
  if (speed === 1) return ''
  const filters: string[] = []
  let s = speed
  // For speed > 2: chain atempo=2 repeatedly until remainder fits 0.5–2
  while (s > 2) { filters.push('atempo=2'); s /= 2 }
  // For speed < 0.5: chain atempo=0.5 repeatedly
  while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5 }
  filters.push(`atempo=${s.toFixed(6)}`)
  return ',' + filters.join(',')
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const {
    clips, sources, audioLayers, overlayLayers, outputFormat, clipCrops, clipZooms, clipSpeeds,
    clipColorCorrections, clipTransitionIn, clipTransitionOut, clipTransitionDurations,
    resolution, subtitleStyle, subtitleAppearance,
    standardSubtitleAppearance, onProgress,
  } = opts

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ffmpeg: any
  try {
    ffmpeg = await getFFmpeg()
  } catch (err) {
    resetFFmpeg()
    throw new Error(`Failed to load FFmpeg: ${err instanceof Error ? err.message : err}`)
  }
  console.log('[export] FFmpeg loaded')
  onProgress(0) // transition UI from "Loading FFmpeg…" → "Exporting…"

  const progressHandler = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
  const logHandler = ({ message }: { message: string }) => console.log('[ffmpeg]', message)
  ffmpeg.on('progress', progressHandler)
  ffmpeg.on('log', logHandler)

  try {
    const timings = getClipTimings(clips, clipSpeeds)
    const totalDuration = timings.length > 0 ? timings[timings.length - 1].end : 0

    // Write source files to FFmpeg virtual FS (deduplicated by sourceId)
    const writtenSources = new Set<string>()
    for (const clip of clips) {
      if (writtenSources.has(clip.sourceId)) continue
      const source = sources.find(s => s.id === clip.sourceId)
      if (!source) { console.warn('[export] source not found for clip', clip.id); continue }
      console.log(`[export] writing source src_${clip.sourceId}.mp4 from ${source.objectUrl}`)
      await ffmpeg.writeFile(`src_${clip.sourceId}.mp4`, await fetchFile(source.objectUrl))
      writtenSources.add(clip.sourceId)
    }

    // Write audio layer files to FFmpeg virtual FS
    for (const layer of audioLayers) {
      if (!layer.objectUrl) { console.warn('[export] audio layer missing objectUrl', layer.id); continue }
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      console.log(`[export] writing audio layer audio_${layer.id}.${ext}`)
      await ffmpeg.writeFile(`audio_${layer.id}.${ext}`, await fetchFile(layer.objectUrl))
    }

    // Determine output dimensions.
    // `resolution` = the SHORT side (standard convention: 1080p means 1080px on the shorter axis).
    // Landscape/square: short side = height. Portrait: short side = width.
    let targetW: number, targetH: number
    if (outputFormat) {
      if (outputFormat.aspectW >= outputFormat.aspectH) {
        // Landscape or square: short side is height
        targetH = resolution
        targetW = Math.round(resolution * outputFormat.aspectW / outputFormat.aspectH)
      } else {
        // Portrait: short side is width
        targetW = resolution
        targetH = Math.round(resolution * outputFormat.aspectH / outputFormat.aspectW)
      }
    } else {
      // "Original" — preserve source aspect ratio, resolution = short side
      const firstSource = sources.find(s => clips.some(c => c.sourceId === s.id))
      const srcW = firstSource?.width ?? 1920
      const srcH = firstSource?.height ?? 1080
      if (srcW >= srcH) {
        // Landscape or square: short side is height
        targetH = resolution
        targetW = Math.round(resolution * srcW / srcH)
      } else {
        // Portrait: short side is width
        targetW = resolution
        targetH = Math.round(resolution * srcH / srcW)
      }
    }

    // Ensure even dimensions (required by H.264)
    const outW = targetW % 2 === 0 ? targetW : targetW + 1
    const outH = targetH % 2 === 0 ? targetH : targetH + 1
    console.log(`[export] output dimensions: ${outW}x${outH}`)

    // Build subtitle events (canvas-rendered, no FFmpeg font dependency)
    const subEvents: SubEvent[] = subtitleStyle !== 'off'
      ? buildSubEvents(timings, sources, subtitleStyle as 'standard' | 'highlight', clipSpeeds)
      : []
    console.log(`[export] ${subEvents.length} subtitle events (style: ${subtitleStyle})`)

    // Build filter graph
    const filterParts: string[] = []
    const inputArgs: string[] = []
    const sourceIndexMap = new Map<string, number>()
    let inputIdx = 0

    for (const sourceId of writtenSources) {
      inputArgs.push('-i', `src_${sourceId}.mp4`)
      sourceIndexMap.set(sourceId, inputIdx++)
    }

    // Audio layer inputs (after all video sources)
    const audioLayerInputIndices: number[] = []
    for (const layer of audioLayers) {
      if (!layer.objectUrl) continue
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      inputArgs.push('-i', `audio_${layer.id}.${ext}`)
      audioLayerInputIndices.push(inputIdx++)
    }

    // Image overlay inputs
    const imageOverlays = overlayLayers.filter(ol => ol.type === 'image' && ol.objectUrl)
    const imageOverlayInputIndices: number[] = []
    for (const ol of imageOverlays) {
      const ext = ol.fileName?.split('.').pop() ?? 'png'
      console.log(`[export] writing image overlay ol_img_${ol.id}.${ext}`)
      await ffmpeg.writeFile(`ol_img_${ol.id}.${ext}`, await fetchFile(ol.objectUrl!))
      inputArgs.push('-loop', '1', '-i', `ol_img_${ol.id}.${ext}`)
      imageOverlayInputIndices.push(inputIdx++)
    }

    // Text overlays — rendered via canvas to avoid FFmpeg font dependency
    const textOverlays = overlayLayers.filter(ol => ol.type === 'text')
    const textOverlayInputIndices: number[] = []
    for (const ol of textOverlays) {
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, outW, outH)

      const baseFontSize   = Math.round(outH * (ol.fontSize ?? 5) / 100)
      const baseFontWeight = ol.fontWeight === 'bold' ? 'bold' : 'normal'
      const cx = Math.round(outW * ol.x / 100)
      const cy = Math.round(outH * ol.y / 100)

      // Parse HTML into styled runs grouped by line
      interface Run { text: string; bold: boolean; italic: boolean; relSize: number }
      function htmlToLines(html: string): Run[][] {
        const lines: Run[][] = [[]]
        function walk(node: Node, bold: boolean, italic: boolean, relSize: number) {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent ?? ''
            if (t) lines[lines.length - 1].push({ text: t, bold, italic, relSize })
            return
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return
          const el = node as HTMLElement
          const tag = el.tagName.toLowerCase()
          if (tag === 'br') { lines.push([]); return }
          if (tag === 'div' && lines[lines.length - 1].length > 0) lines.push([])
          let b = bold  || tag === 'b' || tag === 'strong'
          let i = italic || tag === 'em' || tag === 'i'
          let rs = relSize
          if (tag === 'span') {
            const fs = el.style.fontSize
            if (fs?.endsWith('em')) rs = relSize * parseFloat(fs)
            if (el.style.fontWeight === 'bold' || el.style.fontWeight === '700') b = true
            if (el.style.fontStyle === 'italic') i = true
          }
          for (const child of Array.from(node.childNodes)) walk(child, b, i, rs)
        }
        const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
        walk(doc.body, false, false, 1.0)
        while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
        return lines
      }

      const rawText = ol.text || 'Text'
      const html = rawText.includes('<')
        ? rawText
        : rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      const richLines = htmlToLines(html)

      // Helper: set ctx.font for a run
      function setFont(run: Run) {
        const fs = Math.round(baseFontSize * run.relSize)
        const fw = run.bold ? 'bold' : baseFontWeight
        const fi = run.italic ? 'italic' : 'normal'
        ctx.font = `${fi} ${fw} ${fs}px sans-serif`
      }

      // Measure each line's total width
      const lineWidths = richLines.map(line =>
        line.reduce((total, run) => { setFont(run); return total + ctx.measureText(run.text).width }, 0)
      )
      const maxLineW   = Math.max(...lineWidths, 1)
      const lineHeight = Math.round(baseFontSize * 1.35)
      const totalTextH = richLines.length * lineHeight

      const hasBg     = (ol.bgOpacity ?? 0) > 0
      const borderW   = ol.borderWidth ?? 0
      const hasBorder = borderW > 0
      const radius    = Math.min(ol.borderRadius ?? (hasBg ? 4 : 0), 999)

      if (hasBg || hasBorder) {
        const padX = Math.max(8, Math.round(baseFontSize * 0.3))
        const padY = Math.max(4, Math.round(baseFontSize * 0.15))
        const rx = cx - maxLineW / 2 - padX
        const ry = cy - totalTextH / 2 - padY
        const rw = maxLineW + padX * 2
        const rh = totalTextH + padY * 2
        const r  = Math.min(radius, rw / 2, rh / 2)

        if (hasBg) {
          const hex = ol.bgColor ?? '#000000'
          const ri = parseInt(hex.slice(1, 3), 16)
          const gi = parseInt(hex.slice(3, 5), 16)
          const bi = parseInt(hex.slice(5, 7), 16)
          ctx.fillStyle = `rgba(${ri},${gi},${bi},${ol.bgOpacity})`
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, r)
          ctx.fill()
        }

        if (hasBorder) {
          const bHex = ol.borderColor ?? '#ffffff'
          const ri = parseInt(bHex.slice(1, 3), 16)
          const gi = parseInt(bHex.slice(3, 5), 16)
          const bi = parseInt(bHex.slice(5, 7), 16)
          ctx.strokeStyle = `rgb(${ri},${gi},${bi})`
          ctx.lineWidth = borderW
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, r)
          ctx.stroke()
        }
      }

      // Draw each line's runs left-to-right, centered per line
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      richLines.forEach((line, li) => {
        const lineY = cy - totalTextH / 2 + lineHeight * (li + 0.5)
        let runX = cx - lineWidths[li] / 2
        for (const run of line) {
          setFont(run)
          ctx.fillStyle = ol.color ?? '#ffffff'
          ctx.fillText(run.text, runX, lineY)
          runX += ctx.measureText(run.text).width
        }
      })

      const pngBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
      const pngArr = new Uint8Array(await pngBlob.arrayBuffer())
      const pngFile = `text_ol_${ol.id}.png`
      await ffmpeg.writeFile(pngFile, pngArr)
      console.log(`[export] rendered text overlay "${ol.text}" to ${pngFile} (${pngArr.length} bytes)`)

      inputArgs.push('-loop', '1', '-i', pngFile)
      textOverlayInputIndices.push(inputIdx++)
    }

    // Subtitle inputs — canvas-rendered strip PNGs (narrow height = low memory per image)
    // Highlight mode uses a narrower strip (10% vs 18%) because it generates one PNG per word.
    // At 1080p: 10% strip ≈ 830KB decoded each; 300 word-events ≈ 250MB total — fits in WASM.
    const STRIP_H = subtitleStyle === 'highlight'
      ? Math.round(outH * 0.10)
      : Math.round(outH * 0.18)

    // Step 1: render all subtitle PNGs to the virtual FS (same as before)
    for (let si = 0; si < subEvents.length; si++) {
      const pngData = await renderSubEvent(subEvents[si], outW, outH, STRIP_H, subtitleStyle as 'standard' | 'highlight', standardSubtitleAppearance, subtitleAppearance)
      await ffmpeg.writeFile(`sub_${si}.png`, pngData)
    }
    if (subEvents.length) console.log(`[export] wrote ${subEvents.length} subtitle strip PNGs (${STRIP_H}px tall)`)

    // Step 2: build a single subtitle track using the concat demuxer approach.
    // Instead of N separate overlay filter nodes (O(N) per frame), we create ONE
    // concatenated subtitle stream and use a SINGLE overlay — O(1) per frame.
    const subConcatLabels: string[] = []
    if (subEvents.length > 0) {
      // Transparent blank frame used during gaps between subtitle events
      const blankCanvas = document.createElement('canvas')
      blankCanvas.width = outW
      blankCanvas.height = STRIP_H
      const blankBlob = await new Promise<Blob>(resolve => blankCanvas.toBlob(b => resolve(b!), 'image/png'))
      await ffmpeg.writeFile('sub_blank.png', new Uint8Array(await blankBlob.arrayBuffer()))

      let prevEnd = 0
      for (let si = 0; si < subEvents.length; si++) {
        const ev = subEvents[si]
        // Gap before this event (if any)
        const gapDur = ev.startAt - prevEnd
        if (gapDur > 0.001) {
          inputArgs.push('-t', gapDur.toFixed(3), '-loop', '1', '-i', 'sub_blank.png')
          subConcatLabels.push(`[${inputIdx++}:v]`)
        }
        // This subtitle event
        inputArgs.push('-t', (ev.endAt - ev.startAt).toFixed(3), '-loop', '1', '-i', `sub_${si}.png`)
        subConcatLabels.push(`[${inputIdx++}:v]`)
        prevEnd = ev.endAt
      }
      // Gap after the last event
      const tailGap = totalDuration - prevEnd
      if (tailGap > 0.001) {
        inputArgs.push('-t', tailGap.toFixed(3), '-loop', '1', '-i', 'sub_blank.png')
        subConcatLabels.push(`[${inputIdx++}:v]`)
      }
    }

    const finalVideoLabels: string[] = []

    for (let i = 0; i < timings.length; i++) {
      const timing = timings[i]
      const { clip } = timing
      const srcIdx = sourceIndexMap.get(clip.sourceId)!
      const crop = clipCrops[clip.id] ?? { x: 50, y: 50 }
      const zoom = clipZooms[clip.id] ?? 1

      const speed = clipSpeeds[clip.id] ?? 1
      const speedVideoFilter = speed !== 1 ? `,setpts=PTS/${speed.toFixed(6)}` : ''
      const trimFilter = `[${srcIdx}:v]trim=start=${clip.trimStart}:end=${clip.trimEnd},setpts=PTS-STARTPTS${speedVideoFilter}`
      const trimLabel = `[trim${i}]`

      let scaleAndCrop = ''
      if (outputFormat) {
        const zoomedW = Math.ceil(outW * zoom)
        const zoomedH = Math.ceil(outH * zoom)
        const evenZW = zoomedW % 2 === 0 ? zoomedW : zoomedW + 1
        const evenZH = zoomedH % 2 === 0 ? zoomedH : zoomedH + 1
        const cropX = `(${evenZW}-${outW})*${(crop.x / 100).toFixed(4)}`
        const cropY = `(${evenZH}-${outH})*${(crop.y / 100).toFixed(4)}`
        scaleAndCrop = `,scale=${evenZW}:${evenZH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:${cropX}:${cropY}`
      } else {
        scaleAndCrop = `,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`
      }

      const colorFilter = toFfmpegColorFilter(clipColorCorrections[clip.id] ?? COLOR_CORRECTION_DEFAULT)
      console.log(`[export] clip ${clip.id} colorFilter: "${colorFilter || '(none)'}"`)
      filterParts.push(`${trimFilter}${scaleAndCrop}${colorFilter ? ',' + colorFilter : ''}${trimLabel}`)

      // Apply clip transitions (fade / blur / slide) — returns the final labeled stream
      const tIn  = clipTransitionIn[clip.id]  ?? 'none'
      const tOut = clipTransitionOut[clip.id] ?? 'none'
      const clipDur = clip.trimEnd - clip.trimStart
      const finalLabel = applyClipTransitions(i, clipDur, tIn, tOut, clipTransitionDurations[clip.id] ?? 0.5, outW, outH, filterParts)
      finalVideoLabels.push(finalLabel)

      const atempoChain = buildAtempoChain(speed)
      filterParts.push(`[${srcIdx}:a]atrim=start=${clip.trimStart}:end=${clip.trimEnd},asetpts=PTS-STARTPTS${atempoChain}[atrim${i}]`)
    }

    const videoInputs = finalVideoLabels.join('')
    const audioInputs = timings.map((_, i) => `[atrim${i}]`).join('')
    filterParts.push(`${videoInputs}concat=n=${timings.length}:v=1:a=0[concatv]`)
    filterParts.push(`${audioInputs}concat=n=${timings.length}:v=0:a=1[concata]`)

    // Mix extra audio layers into the video audio
    const validAudioLayers = audioLayers.filter(l => !!l.objectUrl)
    if (validAudioLayers.length > 0) {
      validAudioLayers.forEach((layer, i) => {
        const srcIdx = audioLayerInputIndices[i]
        const delayMs = Math.round(layer.startAt * 1000)
        filterParts.push(
          `[${srcIdx}:a]atrim=start=${layer.trimStart}:end=${layer.trimEnd},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1,volume=${(layer.volume ?? 1).toFixed(3)}[al${i}]`
        )
      })
      const mixInputs = '[concata]' + validAudioLayers.map((_, i) => `[al${i}]`).join('')
      filterParts.push(`${mixInputs}amix=inputs=${validAudioLayers.length + 1}:duration=first:normalize=0[finala]`)
    }

    // Chain overlays: thread a current video label through subtitles → image overlays → text overlays
    let currentV = '[concatv]'

    // Subtitle overlay — one concat filter creates the subtitle track, then ONE overlay
    // composites it onto the video. Replaces the old O(N) chain of N separate overlay nodes.
    if (subConcatLabels.length > 0) {
      filterParts.push(`${subConcatLabels.join('')}concat=n=${subConcatLabels.length}:v=1:a=0[subtitle_track]`)
      const stripY = outH - STRIP_H
      filterParts.push(`${currentV}[subtitle_track]overlay=format=auto:x=0:y=${stripY}[sub_composed]`)
      currentV = '[sub_composed]'
    }

    // Image overlays
    imageOverlays.forEach((ol, i) => {
      const imgIdx = imageOverlayInputIndices[i]
      const scaledW = Math.round(outW * ol.width / 100)
      const scaledLabel = `[ol_scaled_${i}]`
      const outLabel = `[ov${i}]`
      // x/y are the CENTER of the image (matching preview's translate(-50%,-50%))
      // FFmpeg overlay uses top-left, so subtract half the scaled dimensions
      filterParts.push(`[${imgIdx}:v]scale=${scaledW}:-1${scaledLabel}`)
      const cx = Math.round(outW * ol.x / 100)
      const cy = Math.round(outH * ol.y / 100)
      const t0 = ol.startAt.toFixed(3)
      const t1 = (ol.startAt + ol.duration).toFixed(3)
      // Use FFmpeg expressions to offset by half the scaled image size
      filterParts.push(`${currentV}${scaledLabel}overlay=x=${cx}-overlay_w/2:y=${cy}-overlay_h/2:enable='between(t,${t0},${t1})'${outLabel}`)
      currentV = outLabel
    })

    // Text overlays (canvas-rendered full-frame PNGs, no FFmpeg font dependency)
    textOverlays.forEach((ol, i) => {
      const imgIdx = textOverlayInputIndices[i]
      const outLabel = `[dt${i}]`
      const t0 = ol.startAt.toFixed(3)
      const t1 = (ol.startAt + ol.duration).toFixed(3)
      // Full-frame transparent PNG; format=auto preserves alpha blending
      filterParts.push(`${currentV}[${imgIdx}:v]overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      currentV = outLabel
    })

    const filterGraph = filterParts.join(';')
    const finalVideo = currentV
    const finalAudio = validAudioLayers.length > 0 ? '[finala]' : '[concata]'

    const args = [
      ...inputArgs,
      '-filter_complex', filterGraph,
      '-map', finalVideo,
      '-map', finalAudio,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-t', String(totalDuration),
      'output.mp4',
    ]

    console.log('[export] filter_complex:', filterGraph)
    console.log('[export] full args:', args.join(' '))

    const exitCode = await ffmpeg.exec(args)
    console.log('[export] ffmpeg exit code:', exitCode)
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}. Check the console for filter_complex and args.`)
    }

    const data = await ffmpeg.readFile('output.mp4')

    // Cleanup virtual FS
    for (const sourceId of writtenSources) {
      await ffmpeg.deleteFile(`src_${sourceId}.mp4`).catch(() => {})
    }
    for (let si = 0; si < subEvents.length; si++) {
      await ffmpeg.deleteFile(`sub_${si}.png`).catch(() => {})
    }
    await ffmpeg.deleteFile('sub_blank.png').catch(() => {})
    for (const layer of validAudioLayers) {
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      await ffmpeg.deleteFile(`audio_${layer.id}.${ext}`).catch(() => {})
    }
    for (const ol of imageOverlays) {
      const ext = ol.fileName?.split('.').pop() ?? 'png'
      await ffmpeg.deleteFile(`ol_img_${ol.id}.${ext}`).catch(() => {})
    }
    for (const ol of textOverlays) {
      await ffmpeg.deleteFile(`text_ol_${ol.id}.png`).catch(() => {})
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {})

    const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string)
    const plain = new Uint8Array(raw.length)
    plain.set(raw)
    return new Blob([plain.buffer], { type: 'video/mp4' })
  } catch (err) {
    resetFFmpeg() // force fresh instance on next attempt
    throw err
  } finally {
    ffmpeg.off('progress', progressHandler)
    ffmpeg.off('log', logHandler)
  }
}
