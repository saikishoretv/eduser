// @ffmpeg/ffmpeg is loaded at runtime via UMD script tag (public/ffmpeg.js)
// to avoid Turbopack/webpack mangling its `new Worker(new URL(..., import.meta.url))` call.
import { Clip, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer, CcSegment, ShapeLayer, HideLayer } from '@/types'
import { FormatPreset } from '@/lib/formats'
import { SubtitleStyle, SubtitlePosition, TransitionType } from '@/store/store'
import { SubtitleAppearance, StandardSubtitleAppearance } from '@/lib/subtitleTemplates'
import { getClipTimings } from '@/lib/clipUtils'
import { ColorCorrection, COLOR_CORRECTION_DEFAULT, toFfmpegColorFilter } from '@/lib/colorPresets'

export interface ExportOptions {
  clips: Clip[]
  sources: SourceVideo[]
  ccSegments: CcSegment[]
  outputFormat: FormatPreset | null
  clipCrops: Record<string, { x: number; y: number }>
  clipZooms: Record<string, number>
  clipZoomPresets: Record<string, string>
  clipSpeeds: Record<string, number>
  resolution: 720 | 1080
  audioLayers: AudioLayer[]
  overlayLayers: OverlayLayer[]
  clipColorCorrections: Record<string, ColorCorrection>
  clipTransitionIn: Record<string, TransitionType>
  clipTransitionOut: Record<string, TransitionType>
  clipTransitionDurations: Record<string, number>
  subtitleStyle: SubtitleStyle
  subtitlePosition: SubtitlePosition
  subtitleFontSize: number
  subtitleAppearance: SubtitleAppearance
  standardSubtitleAppearance: StandardSubtitleAppearance
  shapeLayers: ShapeLayer[]
  hideLayers: HideLayer[]
  onProgress: (ratio: number) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegInstance: any = null

function detectAudioTrack(objectUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => {
      // audioTracks API works in Firefox and Safari
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioTracks = (v as any).audioTracks
      if (audioTracks !== undefined) { resolve(audioTracks.length > 0); return }
      // Chrome doesn't expose audioTracks — captureStream reflects the container's muxed tracks
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = (v as any).captureStream?.()
        if (stream) { resolve(stream.getAudioTracks().length > 0); return }
      } catch { /* ignore */ }
      // Cannot detect — assume audio present (safer than a silent export)
      resolve(true)
    }
    v.onerror = () => resolve(false)
    v.src = objectUrl
  })
}

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

// Extract the S3 key from a presigned URL so we can proxy it server-side,
// avoiding the S3 CORS restriction on browser fetch().
function s3KeyFromPresignedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    // Presigned URLs have X-Amz-Signature query param; path is /key
    if (!u.searchParams.has('X-Amz-Signature')) return null
    // Strip leading slash to get the S3 key
    return u.pathname.slice(1)
  } catch {
    return null
  }
}

async function fetchFile(input: string | File | Blob): Promise<Uint8Array> {
  if (typeof input === 'string') {
    // Route S3 presigned URLs through our proxy to avoid CORS blocks
    const s3Key = s3KeyFromPresignedUrl(input)
    const url = s3Key ? `/api/s3proxy?key=${encodeURIComponent(s3Key)}` : input
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Failed to fetch source file (HTTP ${r.status}): ${input.slice(0, 80)}`)
    return new Uint8Array(await r.arrayBuffer())
  }
  return new Uint8Array(await input.arrayBuffer())
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

function buildSubEvents(ccSegments: CcSegment[], style: 'standard' | 'highlight'): SubEvent[] {
  const events: SubEvent[] = []
  for (const seg of ccSegments) {
    if (style === 'standard') {
      events.push({ startAt: seg.startAt, endAt: seg.endAt, words: [{ word: seg.text, active: true }] })
    } else {
      const words = seg.words ?? []
      if (!words.length) {
        events.push({ startAt: seg.startAt, endAt: seg.endAt, words: [{ word: seg.text, active: true }] })
        continue
      }
      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi]
        const windowStart = Math.max(0, wi - 1)
        const windowEnd   = Math.min(words.length, windowStart + 4)
        events.push({
          startAt: word.startAt,
          endAt:   word.endAt,
          words: words.slice(windowStart, windowEnd).map((w, di) => ({
            word: w.word,
            active: windowStart + di === wi,
          })),
        })
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

// Wrap plain text into lines that fit within maxWidth, capped at maxLines
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      if (lines.length >= maxLines) return lines
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

async function renderSubEvent(
  event: SubEvent,
  outW: number,
  outH: number,
  stripH: number,
  style: 'standard' | 'highlight',
  position: SubtitlePosition,
  fontSizeMultiplier: number,
  stdApp: StandardSubtitleAppearance,
  hlApp: SubtitleAppearance,
): Promise<Uint8Array> {
  // Render into a strip to minimise per-image memory in FFmpeg
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = stripH
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, outW, stripH)

  const fontSize = Math.round(outH * 0.045 * fontSizeMultiplier)
  const lineH    = Math.round(fontSize * 1.4)
  const edgePad  = Math.round(outW * 0.04)
  // Max text width before wrapping — 70% of frame (matching preview's max-width: 70%)
  const maxTextW = Math.round(outW * 0.70)

  if (style === 'standard') {
    ctx.font = `500 ${fontSize}px sans-serif`
    ctx.textBaseline = 'bottom'
    const padX = Math.round(fontSize * 0.4)
    const padY = Math.round(fontSize * 0.2)

    const lines = wrapTextLines(ctx, event.words[0].word, maxTextW, 3)
    const totalTextH = lines.length * lineH

    // Determine anchor X for text and background rect
    let anchorX: number
    if (position === 'left') {
      ctx.textAlign = 'left'
      anchorX = edgePad
    } else if (position === 'right') {
      ctx.textAlign = 'right'
      anchorX = outW - edgePad
    } else {
      ctx.textAlign = 'center'
      anchorX = outW / 2
    }

    // Bottom of text block sits near the bottom of the strip
    const blockBottom = stripH - padY - 1

    if (stdApp.bgOpacity > 0) {
      // Measure the widest line for background rect
      const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width))
      const rx = position === 'left'  ? edgePad - padX
               : position === 'right' ? outW - edgePad - maxLineW - padX
               : outW / 2 - maxLineW / 2 - padX
      const ry = blockBottom - totalTextH - padY
      const rw = maxLineW + padX * 2
      const rh = totalTextH + padY * 2
      ctx.fillStyle = subHexRgba(stdApp.bgColor, stdApp.bgOpacity)
      ctx.beginPath()
      ctx.roundRect(rx, ry, rw, rh, Math.round(fontSize * 0.15))
      ctx.fill()
    }

    ctx.fillStyle = stdApp.textColor
    lines.forEach((line, li) => {
      const y = blockBottom - (lines.length - 1 - li) * lineH
      ctx.fillText(line, anchorX, y)
    })
  } else {
    const padY  = Math.round(fontSize * 0.25)
    const padX  = Math.round(fontSize * 0.5)
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'

    const spaceW = ctx.measureText(' ').width
    const wordWidths = event.words.map(w => ctx.measureText(w.word).width)
    const totalW = wordWidths.reduce((s, w) => s + w, 0) + spaceW * Math.max(0, event.words.length - 1)

    let startX: number
    if (position === 'left') {
      startX = edgePad
    } else if (position === 'right') {
      startX = outW - edgePad - totalW
    } else {
      startX = outW / 2 - totalW / 2
    }

    const y = stripH - padY - 1

    if (hlApp.bgOpacity > 0) {
      ctx.fillStyle = subHexRgba(hlApp.bgColor, hlApp.bgOpacity)
      ctx.beginPath()
      ctx.roundRect(startX - padX, y - fontSize - padY, totalW + padX * 2, fontSize + padY * 2, Math.round(fontSize * 0.3))
      ctx.fill()
    }
    let curX = startX
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

// ─── Zoom preset filter builder ───────────────────────────────────────────────
// Returns a zoompan filter string (no leading comma) for 'punch' or 'ken-burns'.
// Assumes input frame is already outW×outH (caller pre-scales to cover).
function buildZoomPanFilter(
  preset: string,
  zoom: number,
  crop: { x: number; y: number },
  timelineDur: number,
  outW: number,
  outH: number,
  transDur: number,
): string {
  const d = Math.max(2, Math.ceil(timelineDur * 30))
  const safeD = d - 1  // max frame index for p = on/safeD ∈ [0,1]
  const Z = zoom.toFixed(6)
  const cx = (crop.x / 100).toFixed(6)
  const cy = (crop.y / 100).toFixed(6)
  // x/y: position of the crop window in the input (already outW×outH)
  // x = iw*(1-1/zoom)*cropFrac, clamped to [0, iw-iw/zoom]
  const staticX = `max(0,min(iw-iw/zoom,iw*(1-1/zoom)*${cx}))`
  const staticY = `max(0,min(ih-ih/zoom,ih*(1-1/zoom)*${cy}))`

  if (preset === 'ken-burns') {
    const endCX = ((100 - crop.x) / 100).toFixed(6)
    const endCY = ((100 - crop.y) / 100).toFixed(6)
    const p = `(on/${safeD})`
    const animCX = `(${cx}+(${(parseFloat(endCX) - parseFloat(cx)).toFixed(6)})*${p})`
    const animCY = `(${cy}+(${(parseFloat(endCY) - parseFloat(cy)).toFixed(6)})*${p})`
    const zExpr = `(1+(${Z}-1)*${p})`
    const xExpr = `max(0,min(iw-iw/zoom,iw*(1-1/zoom)*${animCX}))`
    const yExpr = `max(0,min(ih-ih/zoom,ih*(1-1/zoom)*${animCY}))`
    return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${d}:fps=30:s=${outW}x${outH}`
  }

  // punch: ease-in zoom → hold → ease-out zoom
  const ph = Math.min(transDur / Math.max(timelineDur, 0.01), 0.45).toFixed(6)
  const p = `(on/${safeD})`
  const inScale  = `(1+(${Z}-1)*(1-pow(1-${p}/${ph},2)))`
  const outScale = `(${Z}-(${Z}-1)*pow((${p}-(1-${ph}))/${ph},2))`
  const zExpr = `if(lt(${p},${ph}),${inScale},if(gt(${p},1-${ph}),${outScale},${Z}))`
  return `zoompan=z='${zExpr}':x='${staticX}':y='${staticY}':d=${d}:fps=30:s=${outW}x${outH}`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const {
    clips, sources, ccSegments, audioLayers, overlayLayers, outputFormat, clipCrops, clipZooms, clipZoomPresets, clipSpeeds,
    clipColorCorrections, clipTransitionIn, clipTransitionOut, clipTransitionDurations,
    resolution, subtitleStyle, subtitlePosition, subtitleFontSize, subtitleAppearance,
    standardSubtitleAppearance, shapeLayers, hideLayers, onProgress,
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
  onProgress(0)

  const logHandler = ({ message }: { message: string }) => console.log('[ffmpeg]', message)
  ffmpeg.on('log', logHandler)

  try {
    const timings = getClipTimings(clips, clipSpeeds)
    const totalDuration = timings.length > 0 ? timings[timings.length - 1].end : 0
    const N = timings.length

    // ── Output dimensions ────────────────────────────────────────────────────
    let targetW: number, targetH: number
    if (outputFormat) {
      if (outputFormat.aspectW >= outputFormat.aspectH) {
        targetH = resolution
        targetW = Math.round(resolution * outputFormat.aspectW / outputFormat.aspectH)
      } else {
        targetW = resolution
        targetH = Math.round(resolution * outputFormat.aspectH / outputFormat.aspectW)
      }
    } else {
      const firstSource = sources.find(s => clips.some(c => c.sourceId === s.id))
      const srcW = firstSource?.width ?? 1920
      const srcH = firstSource?.height ?? 1080
      if (srcW >= srcH) {
        targetH = resolution
        targetW = Math.round(resolution * srcW / srcH)
      } else {
        targetW = resolution
        targetH = Math.round(resolution * srcH / srcW)
      }
    }
    const outW = targetW % 2 === 0 ? targetW : targetW + 1
    const outH = targetH % 2 === 0 ? targetH : targetH + 1
    console.log(`[export] output dimensions: ${outW}x${outH}, clips: ${N}`)

    // ── Pre-detect audio from objectUrls (before any FS writes) ─────────────
    const sourceAudioMap = new Map<string, boolean>()
    for (const clip of clips) {
      if (clip.background || sourceAudioMap.has(clip.sourceId)) continue
      const src = sources.find(s => s.id === clip.sourceId)
      if (!src || src.isImage || !src.objectUrl) { sourceAudioMap.set(clip.sourceId, false); continue }
      sourceAudioMap.set(clip.sourceId, await detectAudioTrack(src.objectUrl))
    }

    // ── Subtitle setup ───────────────────────────────────────────────────────
    const subEvents: SubEvent[] = subtitleStyle !== 'off' && ccSegments.length > 0
      ? buildSubEvents(ccSegments, subtitleStyle as 'standard' | 'highlight')
      : []
    const subFontPx = Math.round(outH * 0.045 * subtitleFontSize)
    const subLineH  = Math.round(subFontPx * 1.4)
    const STRIP_H   = subtitleStyle === 'highlight'
      ? Math.round(subLineH * 1 + subFontPx * 0.6)
      : Math.round(subLineH * 3 + subFontPx * 0.6)

    for (let si = 0; si < subEvents.length; si++) {
      const pngData = await renderSubEvent(
        subEvents[si], outW, outH, STRIP_H,
        subtitleStyle as 'standard' | 'highlight', subtitlePosition,
        subtitleFontSize, standardSubtitleAppearance, subtitleAppearance,
      )
      await ffmpeg.writeFile(`sub_${si}.png`, pngData)
    }
    if (subEvents.length > 0) {
      const blankCanvas = document.createElement('canvas')
      blankCanvas.width = outW; blankCanvas.height = STRIP_H
      const blankBlob = await new Promise<Blob>(r => blankCanvas.toBlob(b => r(b!), 'image/png'))
      await ffmpeg.writeFile('sub_blank.png', new Uint8Array(await blankBlob.arrayBuffer()))
      console.log(`[export] wrote ${subEvents.length} subtitle strip PNGs (${STRIP_H}px tall)`)
    }

    // ── Shape layer animation frames ─────────────────────────────────────────
    const SHAPE_ANIM_FPS = 30
    const shapeInfos: { frameCount: number; looping?: boolean }[] = []
    for (const sl of shapeLayers) {
      const canvas = document.createElement('canvas')
      canvas.width = outW; canvas.height = outH
      const ctx = canvas.getContext('2d')!
      const pxScale = outW / 640

      if (sl.type === 'ripple') {
        const RIPPLE_CYCLE  = 1.5
        const RIPPLE_OFFSET = 0.75
        const frameCount = Math.ceil(RIPPLE_CYCLE * SHAPE_ANIM_FPS)
        const cx = outW * sl.x / 100; const cy = outH * sl.y / 100
        const maxR = outW * sl.width / 100 / 2
        for (let n = 0; n < frameCount; n++) {
          const t = n / SHAPE_ANIM_FPS
          ctx.clearRect(0, 0, outW, outH); ctx.setLineDash([])
          for (let ring = 0; ring < 2; ring++) {
            const tOff      = ring === 0 ? 0 : RIPPLE_OFFSET
            const rawPhase  = ((t + tOff) % RIPPLE_CYCLE) / RIPPLE_CYCLE
            const eased     = 1 - (1 - rawPhase) ** 2
            const ringR     = maxR * eased
            const ringAlpha = (1 - eased) * sl.strokeOpacity * sl.opacity
            if (ringAlpha < 0.005 || ringR < 0.5) continue
            ctx.globalAlpha = ringAlpha * 0.12; ctx.fillStyle = sl.strokeColor
            ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, 2 * Math.PI); ctx.fill()
            ctx.globalAlpha = ringAlpha; ctx.strokeStyle = sl.strokeColor
            ctx.lineWidth = sl.strokeWidth * pxScale
            ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, 2 * Math.PI); ctx.stroke()
          }
          const dotR = Math.max(2, maxR * 0.1)
          ctx.globalAlpha = 0.9 * sl.strokeOpacity * sl.opacity; ctx.fillStyle = sl.strokeColor
          ctx.beginPath(); ctx.arc(cx, cy, dotR, 0, 2 * Math.PI); ctx.fill()
          ctx.globalAlpha = 1
          const blob  = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
          await ffmpeg.writeFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`, new Uint8Array(await blob.arrayBuffer()))
        }
        shapeInfos.push({ frameCount, looping: true })
      } else {
        const cx  = outW * sl.x / 100; const cy  = outH * sl.y / 100
        const hw  = outW * sl.width  / 100 / 2; const hh  = outH * sl.height / 100 / 2
        const W   = hw * 2; const H   = hh * 2; const x0  = cx - hw; const y0  = cy - hh
        const r   = Math.max(0, Math.min(sl.borderRadius * pxScale, hw, hh))
        const perim = r > 0 ? 2 * (W - 2 * r) + 2 * (H - 2 * r) + 2 * Math.PI * r : 2 * (W + H)
        const animDur   = Math.min(0.8, sl.duration)
        const frameCount = Math.max(2, Math.ceil(animDur * SHAPE_ANIM_FPS))
        for (let n = 0; n < frameCount; n++) {
          const rawProg = frameCount === 1 ? 1 : n / (frameCount - 1)
          const progress = 1 - (1 - rawProg) ** 2
          ctx.clearRect(0, 0, outW, outH); ctx.globalAlpha = sl.opacity
          if (sl.strokeWidth > 0 && sl.strokeOpacity > 0) {
            ctx.strokeStyle = sl.strokeColor + Math.round(sl.strokeOpacity * 255).toString(16).padStart(2, '0')
            ctx.lineWidth = sl.strokeWidth * pxScale
            ctx.setLineDash([perim, perim]); ctx.lineDashOffset = perim * (1 - progress)
            ctx.beginPath()
            if (r <= 0) {
              ctx.moveTo(x0 + W, y0); ctx.lineTo(x0 + W, y0 + H)
              ctx.lineTo(x0, y0 + H); ctx.lineTo(x0, y0); ctx.closePath()
            } else {
              ctx.moveTo(x0 + W - r, y0)
              ctx.arcTo(x0 + W, y0,     x0 + W, y0 + r,     r); ctx.lineTo(x0 + W, y0 + H - r)
              ctx.arcTo(x0 + W, y0 + H, x0 + W - r, y0 + H, r); ctx.lineTo(x0 + r, y0 + H)
              ctx.arcTo(x0,     y0 + H, x0,     y0 + H - r, r); ctx.lineTo(x0,     y0 + r)
              ctx.arcTo(x0,     y0,     x0 + r, y0,         r); ctx.closePath()
            }
            ctx.stroke()
          }
          ctx.globalAlpha = 1
          const blob  = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
          await ffmpeg.writeFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`, new Uint8Array(await blob.arrayBuffer()))
        }
        shapeInfos.push({ frameCount })
      }
    }

    // ── Image overlay files ──────────────────────────────────────────────────
    const imageOverlays = overlayLayers.filter(ol => ol.type === 'image' && ol.objectUrl)
    for (const ol of imageOverlays) {
      const ext = ol.fileName?.split('.').pop() ?? 'png'
      await ffmpeg.writeFile(`ol_img_${ol.id}.${ext}`, await fetchFile(ol.objectUrl!))
    }

    // ── Text overlay PNGs ────────────────────────────────────────────────────
    const textOverlays = overlayLayers.filter(ol => ol.type === 'text')
    for (const ol of textOverlays) {
      const canvas = document.createElement('canvas')
      canvas.width = outW; canvas.height = outH
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, outW, outH)

      const baseFontSize   = Math.round(outH * (ol.fontSize ?? 5) / 100)
      const baseFontWeight = ol.fontWeight === 'bold' ? 'bold' : 'normal'
      const cx = Math.round(outW * ol.x / 100)
      const cy = Math.round(outH * ol.y / 100)

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

      function setFont(run: Run) {
        const fs = Math.round(baseFontSize * run.relSize)
        ctx.font = `${run.italic ? 'italic' : 'normal'} ${run.bold ? 'bold' : baseFontWeight} ${fs}px sans-serif`
      }

      const lineWidths = richLines.map(line =>
        line.reduce((total, run) => { setFont(run); return total + ctx.measureText(run.text).width }, 0)
      )
      const maxLineW   = Math.max(...lineWidths, 1)
      const lineHeight = Math.round(baseFontSize * 1.35)
      const totalTextH = richLines.length * lineHeight
      const hasBg      = (ol.bgOpacity ?? 0) > 0
      const borderW    = ol.borderWidth ?? 0
      const hasBorder  = borderW > 0
      const radius     = Math.min(ol.borderRadius ?? (hasBg ? 4 : 0), 999)

      if (hasBg || hasBorder) {
        const padX = Math.max(8, Math.round(baseFontSize * 0.3))
        const padY = Math.max(4, Math.round(baseFontSize * 0.15))
        const rx = cx - maxLineW / 2 - padX; const ry = cy - totalTextH / 2 - padY
        const rw = maxLineW + padX * 2;       const rh = totalTextH + padY * 2
        const r  = Math.min(radius, rw / 2, rh / 2)
        if (hasBg) {
          const hex = ol.bgColor ?? '#000000'
          ctx.fillStyle = `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${ol.bgOpacity})`
          ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, r); ctx.fill()
        }
        if (hasBorder) {
          const bHex = ol.borderColor ?? '#ffffff'
          ctx.strokeStyle = `rgb(${parseInt(bHex.slice(1,3),16)},${parseInt(bHex.slice(3,5),16)},${parseInt(bHex.slice(5,7),16)})`
          ctx.lineWidth = borderW
          ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, r); ctx.stroke()
        }
      }
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
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
      await ffmpeg.writeFile(`text_ol_${ol.id}.png`, new Uint8Array(await pngBlob.arrayBuffer()))
    }

    // ── Audio layer files ────────────────────────────────────────────────────
    const validAudioLayers = audioLayers.filter(l => !!l.objectUrl)
    for (const layer of validAudioLayers) {
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      await ffmpeg.writeFile(`audio_${layer.id}.${ext}`, await fetchFile(layer.objectUrl!))
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 1 — encode each clip individually to tmp_clip_i.mp4
    // Only one source file lives in the virtual FS at a time, avoiding OOM.
    // ────────────────────────────────────────────────────────────────────────
    const sourcesInFs = new Set<string>()

    for (let i = 0; i < N; i++) {
      const timing     = timings[i]
      const { clip }   = timing
      const source     = sources.find(s => s.id === clip.sourceId)
      const clipDur    = clip.trimEnd - clip.trimStart
      const clipDurStr = clipDur.toFixed(6)
      const speed      = clipSpeeds[clip.id] ?? 1
      const timelineDur = timing.end - timing.start   // = clipDur / speed
      const outFile    = `tmp_clip_${i}.mp4`

      const phaseBase = (i / (N + 1)) * 0.85
      const phaseSize = (1  / (N + 1)) * 0.85
      const p1Handler = ({ progress }: { progress: number }) =>
        onProgress(phaseBase + Math.max(0, Math.min(1, progress)) * phaseSize)
      ffmpeg.on('progress', p1Handler)

      try {
        const clipInputArgs:   string[] = []
        const clipFilterParts: string[] = []
        let finalVideoLabel = '[trim0]'

        if (clip.background) {
          // Render background PNG inline, delete after encode
          const bgCanvas = document.createElement('canvas')
          bgCanvas.width = outW; bgCanvas.height = outH
          const bgCtx = bgCanvas.getContext('2d')!
          if (clip.background.type === 'solid') {
            bgCtx.fillStyle = clip.background.value; bgCtx.fillRect(0, 0, outW, outH)
          } else {
            const m = clip.background.value.match(/linear-gradient\(\s*([^,]+),\s*(.+)\)/i)
            if (m) {
              const angleDeg = parseFloat(m[1]) || 180
              const rad = (angleDeg - 90) * Math.PI / 180
              const grd = bgCtx.createLinearGradient(
                (0.5 - Math.cos(rad) * 0.5) * outW, (0.5 - Math.sin(rad) * 0.5) * outH,
                (0.5 + Math.cos(rad) * 0.5) * outW, (0.5 + Math.sin(rad) * 0.5) * outH,
              )
              m[2].split(',').forEach((stop, idx, arr) => {
                const parts = stop.trim().split(/\s+/)
                grd.addColorStop(parts[1] ? parseFloat(parts[1]) / 100 : idx / Math.max(arr.length - 1, 1), parts[0])
              })
              bgCtx.fillStyle = grd; bgCtx.fillRect(0, 0, outW, outH)
            } else {
              bgCtx.fillStyle = '#000000'; bgCtx.fillRect(0, 0, outW, outH)
            }
          }
          const bgBlob = await new Promise<Blob>(r => bgCanvas.toBlob(b => r(b!), 'image/png'))
          const bgFile = `bg_${clip.id}.png`
          await ffmpeg.writeFile(bgFile, new Uint8Array(await bgBlob.arrayBuffer()))
          clipInputArgs.push('-loop', '1', '-framerate', '25', '-i', bgFile)
          clipFilterParts.push(`[0:v]trim=start=0:end=${clipDurStr},setpts=PTS-STARTPTS,scale=${outW}:${outH},setsar=1,fps=30[trim0]`)
          clipFilterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim0]`)
        } else {
          const srcFileName = source?.isImage ? `src_${clip.sourceId}.jpg` : `src_${clip.sourceId}.mp4`
          if (!sourcesInFs.has(clip.sourceId)) {
            if (source?.objectUrl) {
              console.log(`[export] Phase 1 clip ${i}: writing ${srcFileName}`)
              await ffmpeg.writeFile(srcFileName, await fetchFile(source.objectUrl))
              sourcesInFs.add(clip.sourceId)
            } else {
              console.warn('[export] source has no objectUrl', clip.sourceId)
            }
          }

          if (sourcesInFs.has(clip.sourceId)) {
            if (source?.isImage) {
              clipInputArgs.push('-loop', '1', '-framerate', '25', '-i', srcFileName)
            } else {
              clipInputArgs.push('-i', srcFileName)
            }

            const crop   = clipCrops[clip.id] ?? { x: 50, y: 50 }
            const zoom   = clipZooms[clip.id] ?? 1
            const preset = clipZoomPresets[clip.id] ?? 'none'
            const speedVideoFilter = speed !== 1 ? `,setpts=PTS/${speed.toFixed(6)}` : ''
            const trimFilter = `[0:v]trim=start=${clip.trimStart}:end=${clip.trimEnd},setpts=PTS-STARTPTS${speedVideoFilter}`

            const colorFilter = toFfmpegColorFilter(clipColorCorrections[clip.id] ?? COLOR_CORRECTION_DEFAULT)
            const colorSuffix = colorFilter ? `,${colorFilter}` : ''

            if (preset === 'punch' || preset === 'ken-burns') {
              // Pre-scale to cover outW×outH (centered), then animate via zoompan
              const coverScale = `,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1`
              const zpFilter = buildZoomPanFilter(preset, zoom, crop, timelineDur, outW, outH, clipTransitionDurations[clip.id] ?? 0.5)
              clipFilterParts.push(`${trimFilter}${coverScale},${zpFilter}${colorSuffix},fps=30[trim0]`)
            } else {
              let scaleAndCrop: string
              if (outputFormat || zoom !== 1) {
                const zoomedW = Math.ceil(outW * zoom); const zoomedH = Math.ceil(outH * zoom)
                const evenZW  = zoomedW % 2 === 0 ? zoomedW : zoomedW + 1
                const evenZH  = zoomedH % 2 === 0 ? zoomedH : zoomedH + 1
                const cropX   = `(${evenZW}-${outW})*${(crop.x / 100).toFixed(4)}`
                const cropY   = `(${evenZH}-${outH})*${(crop.y / 100).toFixed(4)}`
                scaleAndCrop  = `,scale=${evenZW}:${evenZH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:${cropX}:${cropY},setsar=1`
              } else {
                scaleAndCrop = `,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1`
              }
              clipFilterParts.push(`${trimFilter}${scaleAndCrop}${colorFilter ? ',' + colorFilter : ''},fps=30[trim0]`)
            }

            const tIn  = clipTransitionIn[clip.id]  ?? 'none'
            const tOut = clipTransitionOut[clip.id] ?? 'none'
            finalVideoLabel = applyClipTransitions(0, clipDur, tIn, tOut, clipTransitionDurations[clip.id] ?? 0.5, outW, outH, clipFilterParts)

            if (!sourceAudioMap.get(clip.sourceId)) {
              clipFilterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim0]`)
            } else {
              const atempoChain = buildAtempoChain(speed)
              clipFilterParts.push(`[0:a]atrim=start=${clip.trimStart}:end=${clip.trimEnd},asetpts=PTS-STARTPTS${atempoChain}[atrim0]`)
            }
          } else {
            // Source missing — substitute a black frame
            clipInputArgs.push('-f', 'lavfi', '-i', `color=c=black:size=${outW}x${outH}:r=30`)
            clipFilterParts.push(`[0:v]trim=end=${clipDurStr},setpts=PTS-STARTPTS,setsar=1,fps=30[trim0]`)
            clipFilterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim0]`)
          }
        }

        const clipArgs = [
          ...clipInputArgs,
          '-filter_complex', clipFilterParts.join(';'),
          '-map', finalVideoLabel,
          '-map', '[atrim0]',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-t', timelineDur.toFixed(6),
          outFile,
        ]
        console.log(`[export] Phase 1 clip ${i}/${N}: filter=${clipFilterParts.join(';')}`)
        let p1ExitCode = await ffmpeg.exec(clipArgs)

        // If failed and a [0:a] filter was used, the source may have no audio stream
        // (detectAudioTrack can false-positive). Retry substituting silence.
        if (p1ExitCode !== 0 && clipFilterParts.some(f => f.startsWith('[0:a]'))) {
          console.warn(`[export] Phase 1 clip ${i}: no audio stream detected, retrying with silence`)
          sourceAudioMap.set(clip.sourceId, false)
          const silentFilterParts = clipFilterParts.map(f =>
            f.startsWith('[0:a]')
              ? `anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim0]`
              : f
          )
          const retryArgs = [
            ...clipInputArgs,
            '-filter_complex', silentFilterParts.join(';'),
            '-map', finalVideoLabel,
            '-map', '[atrim0]',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-t', timelineDur.toFixed(6),
            outFile,
          ]
          p1ExitCode = await ffmpeg.exec(retryArgs)
        }

        if (p1ExitCode !== 0) throw new Error(`FFmpeg Phase 1 clip ${i} exited with code ${p1ExitCode}`)

        // Delete background PNG right after encode
        if (clip.background) await ffmpeg.deleteFile(`bg_${clip.id}.png`).catch(() => {})

        // Delete source file when no later clip needs it
        if (!clip.background && sourcesInFs.has(clip.sourceId)) {
          const stillNeeded = timings.slice(i + 1).some(t => t.clip.sourceId === clip.sourceId)
          if (!stillNeeded) {
            await ffmpeg.deleteFile(source?.isImage ? `src_${clip.sourceId}.jpg` : `src_${clip.sourceId}.mp4`).catch(() => {})
            sourcesInFs.delete(clip.sourceId)
          }
        }
      } finally {
        ffmpeg.off('progress', p1Handler)
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 2 — concat pre-encoded clips + global filters + final encode
    // ────────────────────────────────────────────────────────────────────────
    const p2InputArgs:   string[] = []
    const p2FilterParts: string[] = []
    let p2InputIdx = 0

    // Clip inputs
    for (let i = 0; i < N; i++) p2InputArgs.push('-i', `tmp_clip_${i}.mp4`)
    p2InputIdx = N

    // Concat
    const vInputs = Array.from({ length: N }, (_, i) => `[${i}:v]`).join('')
    const aInputs = Array.from({ length: N }, (_, i) => `[${i}:a]`).join('')
    p2FilterParts.push(`${vInputs}concat=n=${N}:v=1:a=0[concatv]`)
    p2FilterParts.push(`${aInputs}concat=n=${N}:v=0:a=1[concata]`)

    // Audio layer inputs
    const audioLayerInputIndices: number[] = []
    for (const layer of validAudioLayers) {
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      p2InputArgs.push('-i', `audio_${layer.id}.${ext}`)
      audioLayerInputIndices.push(p2InputIdx++)
    }

    // Shape layer inputs
    const shapeInputInfosP2: { animIdx: number; frameCount: number; looping?: boolean }[] = []
    for (let si = 0; si < shapeLayers.length; si++) {
      const sl = shapeLayers[si]
      const { frameCount, looping } = shapeInfos[si]
      p2InputArgs.push('-itsoffset', sl.startAt.toFixed(6), '-framerate', String(SHAPE_ANIM_FPS), '-i', `shape_${sl.id}_f%03d.png`)
      shapeInputInfosP2.push({ animIdx: p2InputIdx++, frameCount, looping })
    }

    // Image overlay inputs
    const imageOverlayInputIndices: number[] = []
    for (const ol of imageOverlays) {
      const ext = ol.fileName?.split('.').pop() ?? 'png'
      p2InputArgs.push('-loop', '1', '-i', `ol_img_${ol.id}.${ext}`)
      imageOverlayInputIndices.push(p2InputIdx++)
    }

    // Text overlay inputs
    const textOverlayInputIndices: number[] = []
    for (const ol of textOverlays) {
      p2InputArgs.push('-loop', '1', '-i', `text_ol_${ol.id}.png`)
      textOverlayInputIndices.push(p2InputIdx++)
    }

    // Subtitle track inputs
    const subConcatLabels: string[] = []
    if (subEvents.length > 0) {
      let prevEnd = 0
      for (let si = 0; si < subEvents.length; si++) {
        const ev = subEvents[si]
        const gapDur = ev.startAt - prevEnd
        if (gapDur > 0.001) {
          p2InputArgs.push('-t', gapDur.toFixed(3), '-loop', '1', '-i', 'sub_blank.png')
          subConcatLabels.push(`[${p2InputIdx++}:v]`)
        }
        p2InputArgs.push('-t', (ev.endAt - ev.startAt).toFixed(3), '-loop', '1', '-i', `sub_${si}.png`)
        subConcatLabels.push(`[${p2InputIdx++}:v]`)
        prevEnd = ev.endAt
      }
      const tailGap = totalDuration - prevEnd
      if (tailGap > 0.001) {
        p2InputArgs.push('-t', tailGap.toFixed(3), '-loop', '1', '-i', 'sub_blank.png')
        subConcatLabels.push(`[${p2InputIdx++}:v]`)
      }
    }

    // Audio layer mixing
    if (validAudioLayers.length > 0) {
      validAudioLayers.forEach((layer, i) => {
        const srcIdx  = audioLayerInputIndices[i]
        const delayMs = Math.round(layer.startAt * 1000)
        const trimDur = layer.trimEnd - layer.trimStart
        const fadeIn  = layer.fadeIn  ?? 0
        const fadeOut = layer.fadeOut ?? 0
        const fadeFilters = [
          fadeIn  > 0 ? `,afade=t=in:st=0:d=${fadeIn.toFixed(3)}`                                              : '',
          fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, trimDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : '',
        ].join('')
        p2FilterParts.push(
          `[${srcIdx}:a]atrim=start=${layer.trimStart}:end=${layer.trimEnd},asetpts=PTS-STARTPTS${fadeFilters},adelay=${delayMs}:all=1,volume=${(layer.volume ?? 1).toFixed(3)}[al${i}]`
        )
      })
      const mixInputs = '[concata]' + validAudioLayers.map((_, i) => `[al${i}]`).join('')
      p2FilterParts.push(`${mixInputs}amix=inputs=${validAudioLayers.length + 1}:duration=first:normalize=0[finala]`)
    }

    // Chain overlays: subtitles → shapes → image overlays → text overlays → hide layers
    let currentV = '[concatv]'

    if (subConcatLabels.length > 0) {
      p2FilterParts.push(`${subConcatLabels.join('')}concat=n=${subConcatLabels.length}:v=1:a=0[subtitle_track]`)
      const stripY = subtitlePosition === 'top' ? 0
        : (subtitlePosition === 'left' || subtitlePosition === 'right') ? Math.round((outH - STRIP_H) / 2)
        : outH - STRIP_H
      p2FilterParts.push(`${currentV}[subtitle_track]overlay=format=auto:x=0:y=${stripY}[sub_composed]`)
      currentV = '[sub_composed]'
    }

    shapeLayers.forEach((sl, i) => {
      const { animIdx, frameCount, looping } = shapeInputInfosP2[i]
      const t0 = sl.startAt.toFixed(3); const t1 = (sl.startAt + sl.duration).toFixed(3)
      const outLabel = `[sh${i}]`
      if (looping) {
        const loopLabel = `[sh${i}_loop]`
        p2FilterParts.push(`[${animIdx}:v]loop=loop=-1:size=${frameCount}:start=0${loopLabel}`)
        p2FilterParts.push(`${currentV}${loopLabel}overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      } else {
        p2FilterParts.push(`${currentV}[${animIdx}:v]overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      }
      currentV = outLabel
    })

    imageOverlays.forEach((ol, i) => {
      const imgIdx  = imageOverlayInputIndices[i]
      const scaledW = Math.round(outW * ol.width / 100)
      const scaledLabel = `[ol_scaled_${i}]`; const outLabel = `[ov${i}]`
      p2FilterParts.push(`[${imgIdx}:v]scale=${scaledW}:-1${scaledLabel}`)
      const cx = Math.round(outW * ol.x / 100); const cy = Math.round(outH * ol.y / 100)
      const t0 = ol.startAt.toFixed(3);          const t1 = (ol.startAt + ol.duration).toFixed(3)
      p2FilterParts.push(`${currentV}${scaledLabel}overlay=x=${cx}-overlay_w/2:y=${cy}-overlay_h/2:enable='between(t,${t0},${t1})'${outLabel}`)
      currentV = outLabel
    })

    textOverlays.forEach((ol, i) => {
      const imgIdx = textOverlayInputIndices[i]; const outLabel = `[dt${i}]`
      const t0 = ol.startAt.toFixed(3);           const t1 = (ol.startAt + ol.duration).toFixed(3)
      p2FilterParts.push(`${currentV}[${imgIdx}:v]overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      currentV = outLabel
    })

    hideLayers.forEach((hl, i) => {
      const t0 = hl.startAt.toFixed(3); const t1 = (hl.startAt + hl.duration).toFixed(3)
      const en = `enable='between(t,${t0},${t1})'`
      const px = Math.round(outW * hl.x / 100); const py = Math.round(outH * hl.y / 100)
      const pw = Math.max(1, Math.round(outW * hl.w / 100)); const ph = Math.max(1, Math.round(outH * hl.h / 100))
      const outLabel = `[hd${i}]`
      if (hl.style === 'black') {
        p2FilterParts.push(`${currentV}drawbox=x=${px}:y=${py}:w=${pw}:h=${ph}:color=black:t=fill:${en}${outLabel}`)
      } else {
        p2FilterParts.push(`${currentV}split[hd${i}_base][hd${i}_split]`)
        p2FilterParts.push(`[hd${i}_split]crop=${pw}:${ph}:${px}:${py}[hd${i}_crop]`)
        p2FilterParts.push(`[hd${i}_crop]gblur=sigma=20[hd${i}_blurred]`)
        p2FilterParts.push(`[hd${i}_base][hd${i}_blurred]overlay=x=${px}:y=${py}:${en}${outLabel}`)
      }
      currentV = outLabel
    })

    const filterGraph = p2FilterParts.join(';')
    const finalVideo  = currentV
    const finalAudio  = validAudioLayers.length > 0 ? '[finala]' : '[concata]'

    console.log('[export] Phase 2 filter_complex:', filterGraph)

    const p2Handler = ({ progress }: { progress: number }) =>
      onProgress(0.85 + Math.max(0, Math.min(1, progress)) * 0.15)
    ffmpeg.on('progress', p2Handler)

    let p2ExitCode: number
    try {
      const p2Args = [
        ...p2InputArgs,
        '-filter_complex', filterGraph,
        '-map', finalVideo,
        '-map', finalAudio,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-t', String(totalDuration),
        'output.mp4',
      ]
      console.log('[export] Phase 2 args:', p2Args.join(' '))
      p2ExitCode = await ffmpeg.exec(p2Args)
    } finally {
      ffmpeg.off('progress', p2Handler)
    }

    if (p2ExitCode !== 0) {
      throw new Error(`FFmpeg Phase 2 exited with code ${p2ExitCode}. Check the console for filter_complex and args.`)
    }

    const data = await ffmpeg.readFile('output.mp4')

    // ── Cleanup ──────────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) await ffmpeg.deleteFile(`tmp_clip_${i}.mp4`).catch(() => {})
    for (let si = 0; si < subEvents.length; si++) await ffmpeg.deleteFile(`sub_${si}.png`).catch(() => {})
    if (subEvents.length > 0) await ffmpeg.deleteFile('sub_blank.png').catch(() => {})
    for (const layer of validAudioLayers) {
      await ffmpeg.deleteFile(`audio_${layer.id}.${layer.fileName.split('.').pop() ?? 'mp3'}`).catch(() => {})
    }
    for (const ol of imageOverlays) {
      await ffmpeg.deleteFile(`ol_img_${ol.id}.${ol.fileName?.split('.').pop() ?? 'png'}`).catch(() => {})
    }
    for (const ol of textOverlays) await ffmpeg.deleteFile(`text_ol_${ol.id}.png`).catch(() => {})
    for (let i = 0; i < shapeLayers.length; i++) {
      const sl = shapeLayers[i]; const { frameCount } = shapeInfos[i]
      for (let n = 0; n < frameCount; n++)
        await ffmpeg.deleteFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`).catch(() => {})
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {})

    const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string)
    const plain = new Uint8Array(raw.length)
    plain.set(raw)
    return new Blob([plain.buffer], { type: 'video/mp4' })
  } catch (err) {
    resetFFmpeg()
    throw err
  } finally {
    ffmpeg.off('log', logHandler)
  }
}
