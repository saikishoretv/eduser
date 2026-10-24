// @ffmpeg/ffmpeg is loaded at runtime via UMD script tag (public/ffmpeg.js)
// to avoid Turbopack/webpack mangling its `new Worker(new URL(..., import.meta.url))` call.
import { Clip, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer, CcSegment, ShapeLayer } from '@/types'
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const {
    clips, sources, ccSegments, audioLayers, overlayLayers, outputFormat, clipCrops, clipZooms, clipSpeeds,
    clipColorCorrections, clipTransitionIn, clipTransitionOut, clipTransitionDurations,
    resolution, subtitleStyle, subtitlePosition, subtitleFontSize, subtitleAppearance,
    standardSubtitleAppearance, shapeLayers, onProgress,
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

    // Write source files to FFmpeg virtual FS (deduplicated by sourceId).
    // Background clips and image clips don't need a video source file — skip them.
    const writtenSources = new Set<string>()
    for (const clip of clips) {
      if (clip.background) continue  // handled via canvas PNG
      if (writtenSources.has(clip.sourceId)) continue
      const source = sources.find(s => s.id === clip.sourceId)
      if (!source) { console.warn('[export] source not found for clip', clip.id); continue }
      if (!source.objectUrl) { console.warn('[export] source has no objectUrl', clip.sourceId); continue }
      console.log(`[export] writing source src_${clip.sourceId}.mp4 from ${source.objectUrl.slice(0, 60)}`)
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
    const subEvents: SubEvent[] = subtitleStyle !== 'off' && ccSegments.length > 0
      ? buildSubEvents(ccSegments, subtitleStyle as 'standard' | 'highlight')
      : []
    console.log(`[export] ${subEvents.length} subtitle events (style: ${subtitleStyle}, fontSize: ${subtitleFontSize})`)

    // Build filter graph
    // Always re-detect audio via HTMLVideoElement so projects uploaded before the audioTracks
    // Chrome bug was fixed still export with correct audio (stored hasAudio may be wrong).
    const sourceAudioMap = new Map<string, boolean>()
    for (const sourceId of writtenSources) {
      const src = sources.find(s => s.id === sourceId)
      if (!src || src.isImage) { sourceAudioMap.set(sourceId, false); continue }
      sourceAudioMap.set(sourceId, src.objectUrl ? await detectAudioTrack(src.objectUrl) : false)
    }

    const filterParts: string[] = []
    const inputArgs: string[] = []
    const sourceIndexMap = new Map<string, number>()
    let inputIdx = 0

    for (const sourceId of writtenSources) {
      const src = sources.find(s => s.id === sourceId)
      if (src?.isImage) {
        // Freeze-frame: loop the single JPEG frame so trim filters work normally
        inputArgs.push('-loop', '1', '-framerate', '25', '-i', `src_${sourceId}.mp4`)
      } else {
        inputArgs.push('-i', `src_${sourceId}.mp4`)
      }
      sourceIndexMap.set(sourceId, inputIdx++)
    }

    // Pre-render background clips (solid / gradient) to PNG so FFmpeg can use them
    const bgClipInputIndices = new Map<string, number>()
    for (const clip of clips) {
      if (!clip.background) continue
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')!
      if (clip.background.type === 'solid') {
        ctx.fillStyle = clip.background.value
        ctx.fillRect(0, 0, outW, outH)
      } else {
        // Gradient: parse linear-gradient(angle, stop1, stop2, ...) into CanvasGradient
        const m = clip.background.value.match(/linear-gradient\(\s*([^,]+),\s*(.+)\)/i)
        if (m) {
          const angleDeg = parseFloat(m[1]) || 180
          const rad = (angleDeg - 90) * Math.PI / 180
          const grd = ctx.createLinearGradient(
            (0.5 - Math.cos(rad) * 0.5) * outW, (0.5 - Math.sin(rad) * 0.5) * outH,
            (0.5 + Math.cos(rad) * 0.5) * outW, (0.5 + Math.sin(rad) * 0.5) * outH,
          )
          m[2].split(',').forEach((stop, idx, arr) => {
            const parts = stop.trim().split(/\s+/)
            grd.addColorStop(parts[1] ? parseFloat(parts[1]) / 100 : idx / Math.max(arr.length - 1, 1), parts[0])
          })
          ctx.fillStyle = grd
          ctx.fillRect(0, 0, outW, outH)
        } else {
          ctx.fillStyle = '#000000'
          ctx.fillRect(0, 0, outW, outH)
        }
      }
      const pngBlob2 = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'))
      const pngArr = new Uint8Array(await pngBlob2.arrayBuffer() as ArrayBuffer)
      const pngFile = `bg_${clip.id}.png`
      await ffmpeg.writeFile(pngFile, pngArr)
      inputArgs.push('-loop', '1', '-framerate', '25', '-i', pngFile)
      bgClipInputIndices.set(clip.id, inputIdx++)
    }

    // Audio layer inputs (after all video sources)
    const audioLayerInputIndices: number[] = []
    for (const layer of audioLayers) {
      if (!layer.objectUrl) continue
      const ext = layer.fileName.split('.').pop() ?? 'mp3'
      inputArgs.push('-i', `audio_${layer.id}.${ext}`)
      audioLayerInputIndices.push(inputIdx++)
    }

    // Shape layer inputs — draw-on animation as a PNG image sequence.
    // Each shape generates frameCount frames (progress 0→1 over 0.8s ease-out).
    // -itsoffset sl.startAt delays the sequence to the shape's timeline position so the
    // animation starts exactly when the shape appears. eof_action=repeat (overlay default)
    // holds the last fully-drawn frame for the rest of the shape's visible duration.
    // The overlay filter skips consuming input 1 when enable=0, so no frames are wasted.
    const SHAPE_ANIM_FPS = 30
    const shapeInputInfos: { animIdx: number; frameCount: number; looping?: boolean }[] = []
    for (const sl of shapeLayers) {
      const canvas = document.createElement('canvas')
      canvas.width  = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')!
      const pxScale = outW / 640

      if (sl.type === 'ripple') {
        // Two rings that expand and fade, looping every 1.5s.
        // We generate exactly one cycle (45 frames) and loop them in filter_complex.
        const RIPPLE_CYCLE  = 1.5
        const RIPPLE_OFFSET = 0.75  // ring 2 is half a cycle ahead (matches CSS animation-delay: -0.75s)
        const frameCount    = Math.ceil(RIPPLE_CYCLE * SHAPE_ANIM_FPS)  // 45
        const cx = outW * sl.x / 100
        const cy = outH * sl.y / 100
        const maxR = outW * sl.width / 100 / 2

        for (let n = 0; n < frameCount; n++) {
          const t = n / SHAPE_ANIM_FPS
          ctx.clearRect(0, 0, outW, outH)
          ctx.setLineDash([])

          for (let ring = 0; ring < 2; ring++) {
            const tOff      = ring === 0 ? 0 : RIPPLE_OFFSET
            const rawPhase  = ((t + tOff) % RIPPLE_CYCLE) / RIPPLE_CYCLE
            const eased     = 1 - (1 - rawPhase) ** 2  // ease-out quadratic
            const ringR     = maxR * eased
            const ringAlpha = (1 - eased) * sl.strokeOpacity * sl.opacity
            if (ringAlpha < 0.005 || ringR < 0.5) continue
            // Slight fill — matches SVG fillOpacity 0.12
            ctx.globalAlpha = ringAlpha * 0.12
            ctx.fillStyle   = sl.strokeColor
            ctx.beginPath()
            ctx.arc(cx, cy, ringR, 0, 2 * Math.PI)
            ctx.fill()
            // Ring stroke
            ctx.globalAlpha = ringAlpha
            ctx.strokeStyle = sl.strokeColor
            ctx.lineWidth   = sl.strokeWidth * pxScale
            ctx.beginPath()
            ctx.arc(cx, cy, ringR, 0, 2 * Math.PI)
            ctx.stroke()
          }
          // Static center dot
          const dotR = Math.max(2, maxR * 0.1)
          ctx.globalAlpha = 0.9 * sl.strokeOpacity * sl.opacity
          ctx.fillStyle   = sl.strokeColor
          ctx.beginPath()
          ctx.arc(cx, cy, dotR, 0, 2 * Math.PI)
          ctx.fill()

          const blob  = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
          const bytes = new Uint8Array(await blob.arrayBuffer())
          await ffmpeg.writeFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`, bytes)
        }

        inputArgs.push('-itsoffset', sl.startAt.toFixed(6), '-framerate', String(SHAPE_ANIM_FPS), '-i', `shape_${sl.id}_f%03d.png`)
        shapeInputInfos.push({ animIdx: inputIdx++, frameCount, looping: true })
      } else {
        // Rectangle: draw-on stroke animation, hold last frame
        const cx  = outW * sl.x / 100
        const cy  = outH * sl.y / 100
        const hw  = outW * sl.width  / 100 / 2
        const hh  = outH * sl.height / 100 / 2
        const W   = hw * 2
        const H   = hh * 2
        const x0  = cx - hw
        const y0  = cy - hh
        const r = Math.max(0, Math.min(sl.borderRadius * pxScale, hw, hh))
        const perim  = r > 0 ? 2 * (W - 2 * r) + 2 * (H - 2 * r) + 2 * Math.PI * r : 2 * (W + H)

        const animDur  = Math.min(0.8, sl.duration)
        const frameCount = Math.max(2, Math.ceil(animDur * SHAPE_ANIM_FPS))

        for (let n = 0; n < frameCount; n++) {
          const rawProg = frameCount === 1 ? 1 : n / (frameCount - 1)  // 0 → 1
          const progress = 1 - (1 - rawProg) ** 2                       // ease-out quadratic
          ctx.clearRect(0, 0, outW, outH)
          ctx.globalAlpha = sl.opacity
          if (sl.strokeWidth > 0 && sl.strokeOpacity > 0) {
            ctx.strokeStyle = sl.strokeColor + Math.round(sl.strokeOpacity * 255).toString(16).padStart(2, '0')
            ctx.lineWidth   = sl.strokeWidth * pxScale
            ctx.setLineDash([perim, perim])
            ctx.lineDashOffset = perim * (1 - progress)  // perim=invisible → 0=fully drawn
            ctx.beginPath()
            if (r <= 0) {
              ctx.moveTo(x0 + W, y0)
              ctx.lineTo(x0 + W, y0 + H)
              ctx.lineTo(x0,     y0 + H)
              ctx.lineTo(x0,     y0)
              ctx.closePath()
            } else {
              ctx.moveTo(x0 + W - r, y0)
              ctx.arcTo(x0 + W, y0,     x0 + W, y0 + r,     r)
              ctx.lineTo(x0 + W, y0 + H - r)
              ctx.arcTo(x0 + W, y0 + H, x0 + W - r, y0 + H, r)
              ctx.lineTo(x0 + r, y0 + H)
              ctx.arcTo(x0,     y0 + H, x0,     y0 + H - r, r)
              ctx.lineTo(x0,     y0 + r)
              ctx.arcTo(x0,     y0,     x0 + r, y0,         r)
              ctx.closePath()
            }
            ctx.stroke()
          }
          const blob  = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
          const bytes = new Uint8Array(await blob.arrayBuffer())
          await ffmpeg.writeFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`, bytes)
        }

        console.log(`[export] shape ${sl.id}: wrote ${frameCount} anim frames, itsoffset=${sl.startAt.toFixed(3)}, inputIdx=${inputIdx}`)
        inputArgs.push('-itsoffset', sl.startAt.toFixed(6), '-framerate', String(SHAPE_ANIM_FPS), '-i', `shape_${sl.id}_f%03d.png`)
        shapeInputInfos.push({ animIdx: inputIdx++, frameCount })
      }
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

    // Subtitle strip height: sized to fit up to 3 lines of text at the chosen font size.
    // line height ≈ fontSize * 1.4; fontSize = outH * 0.045 * multiplier; add padding.
    const subFontPx = Math.round(outH * 0.045 * subtitleFontSize)
    const subLineH  = Math.round(subFontPx * 1.4)
    // Standard can wrap to 3 lines; highlight shows 1 line of up to 4 words.
    const STRIP_H = subtitleStyle === 'highlight'
      ? Math.round(subLineH * 1 + subFontPx * 0.6)   // 1 line + padding
      : Math.round(subLineH * 3 + subFontPx * 0.6)   // 3 lines + padding

    // Step 1: render all subtitle PNGs to the virtual FS (same as before)
    for (let si = 0; si < subEvents.length; si++) {
      const pngData = await renderSubEvent(subEvents[si], outW, outH, STRIP_H, subtitleStyle as 'standard' | 'highlight', subtitlePosition, subtitleFontSize, standardSubtitleAppearance, subtitleAppearance)
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
      const source = sources.find(s => s.id === clip.sourceId)
      const clipDur = clip.trimEnd - clip.trimStart
      const clipDurStr = clipDur.toFixed(6)
      const speed = clipSpeeds[clip.id] ?? 1
      const trimLabel = `[trim${i}]`

      if (clip.background) {
        // Background clip — use pre-rendered PNG input, no audio stream
        const bgIdx = bgClipInputIndices.get(clip.id)!
        filterParts.push(`[${bgIdx}:v]trim=start=0:end=${clipDurStr},setpts=PTS-STARTPTS,scale=${outW}:${outH},setsar=1,fps=30${trimLabel}`)
        filterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim${i}]`)
        finalVideoLabels.push(trimLabel)
        continue
      }

      const srcIdx = sourceIndexMap.get(clip.sourceId)
      if (srcIdx === undefined) {
        // Source wasn't written (missing objectUrl) — substitute a black frame so the
        // filter graph doesn't contain the literal string "[undefined:v]" which breaks everything
        console.warn('[export] no source for clip, substituting black frame', clip.id, clip.sourceId)
        filterParts.push(`color=c=black:size=${outW}x${outH}:rate=30:duration=${clipDurStr},setpts=PTS-STARTPTS,setsar=1${trimLabel}`)
        filterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim${i}]`)
        finalVideoLabels.push(trimLabel)
        continue
      }

      const crop = clipCrops[clip.id] ?? { x: 50, y: 50 }
      const zoom = clipZooms[clip.id] ?? 1
      const speedVideoFilter = speed !== 1 ? `,setpts=PTS/${speed.toFixed(6)}` : ''
      const trimFilter = `[${srcIdx}:v]trim=start=${clip.trimStart}:end=${clip.trimEnd},setpts=PTS-STARTPTS${speedVideoFilter}`

      let scaleAndCrop = ''
      if (outputFormat || zoom !== 1) {
        const zoomedW = Math.ceil(outW * zoom)
        const zoomedH = Math.ceil(outH * zoom)
        const evenZW = zoomedW % 2 === 0 ? zoomedW : zoomedW + 1
        const evenZH = zoomedH % 2 === 0 ? zoomedH : zoomedH + 1
        const cropX = `(${evenZW}-${outW})*${(crop.x / 100).toFixed(4)}`
        const cropY = `(${evenZH}-${outH})*${(crop.y / 100).toFixed(4)}`
        scaleAndCrop = `,scale=${evenZW}:${evenZH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:${cropX}:${cropY},setsar=1`
      } else {
        scaleAndCrop = `,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1`
      }

      const colorFilter = toFfmpegColorFilter(clipColorCorrections[clip.id] ?? COLOR_CORRECTION_DEFAULT)
      console.log(`[export] clip ${clip.id} colorFilter: "${colorFilter || '(none)'}"`)
      filterParts.push(`${trimFilter}${scaleAndCrop}${colorFilter ? ',' + colorFilter : ''},fps=30${trimLabel}`)

      const tIn  = clipTransitionIn[clip.id]  ?? 'none'
      const tOut = clipTransitionOut[clip.id] ?? 'none'
      const finalLabel = applyClipTransitions(i, clipDur, tIn, tOut, clipTransitionDurations[clip.id] ?? 0.5, outW, outH, filterParts)
      finalVideoLabels.push(finalLabel)

      // Use silence for image sources and for video sources that have no audio track
      if (!sourceAudioMap.get(clip.sourceId)) {
        filterParts.push(`anullsrc=r=48000:cl=stereo:d=${clipDurStr},asetpts=PTS-STARTPTS[atrim${i}]`)
      } else {
        const atempoChain = buildAtempoChain(speed)
        filterParts.push(`[${srcIdx}:a]atrim=start=${clip.trimStart}:end=${clip.trimEnd},asetpts=PTS-STARTPTS${atempoChain}[atrim${i}]`)
      }
    }

    const videoInputs = finalVideoLabels.join('')
    const audioInputs = timings.map((_, i) => `[atrim${i}]`).join('')
    filterParts.push(`${videoInputs}concat=n=${timings.length}:v=1:a=0[concatv]`)
    filterParts.push(`${audioInputs}concat=n=${timings.length}:v=0:a=1[concata]`)

    // Mix extra audio layers into the video audio
    const validAudioLayers = audioLayers.filter(l => !!l.objectUrl)
    if (validAudioLayers.length > 0) {
      validAudioLayers.forEach((layer, i) => {
        const srcIdx  = audioLayerInputIndices[i]
        const delayMs = Math.round(layer.startAt * 1000)
        const trimDur = layer.trimEnd - layer.trimStart
        const fadeIn  = layer.fadeIn  ?? 0
        const fadeOut = layer.fadeOut ?? 0
        const fadeFilters = [
          fadeIn  > 0 ? `,afade=t=in:st=0:d=${fadeIn.toFixed(3)}`                          : '',
          fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, trimDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : '',
        ].join('')
        filterParts.push(
          `[${srcIdx}:a]atrim=start=${layer.trimStart}:end=${layer.trimEnd},asetpts=PTS-STARTPTS${fadeFilters},adelay=${delayMs}:all=1,volume=${(layer.volume ?? 1).toFixed(3)}[al${i}]`
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
      const stripY = subtitlePosition === 'top' ? 0
        : (subtitlePosition === 'left' || subtitlePosition === 'right') ? Math.round((outH - STRIP_H) / 2)
        : outH - STRIP_H
      filterParts.push(`${currentV}[subtitle_track]overlay=format=auto:x=0:y=${stripY}[sub_composed]`)
      currentV = '[sub_composed]'
    }

    // Shape overlays
    shapeLayers.forEach((sl, i) => {
      const { animIdx, frameCount, looping } = shapeInputInfos[i]
      const t0       = sl.startAt.toFixed(3)
      const t1       = (sl.startAt + sl.duration).toFixed(3)
      const outLabel = `[sh${i}]`
      if (looping) {
        // Ripple: loop the one-cycle sequence for the full shape duration
        const loopLabel = `[sh${i}_loop]`
        filterParts.push(`[${animIdx}:v]loop=loop=-1:size=${frameCount}:start=0${loopLabel}`)
        filterParts.push(`${currentV}${loopLabel}overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      } else {
        // Rectangle: eof_action=repeat holds the fully-drawn last frame
        filterParts.push(`${currentV}[${animIdx}:v]overlay=format=auto:x=0:y=0:enable='between(t,${t0},${t1})'${outLabel}`)
      }
      currentV = outLabel
    })

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
    for (const clip of clips) {
      if (clip.background) await ffmpeg.deleteFile(`bg_${clip.id}.png`).catch(() => {})
    }
    for (let i = 0; i < shapeLayers.length; i++) {
      const sl = shapeLayers[i]
      const { frameCount } = shapeInputInfos[i]
      for (let n = 0; n < frameCount; n++) {
        await ffmpeg.deleteFile(`shape_${sl.id}_f${String(n).padStart(3, '0')}.png`).catch(() => {})
      }
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
