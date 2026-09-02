import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { Clip, SourceVideo, TranscriptSegment, AudioLayer, OverlayLayer } from '@/types'
import { FormatPreset } from '@/lib/formats'
import { SubtitleStyle } from '@/store/store'
import { SubtitleAppearance, StandardSubtitleAppearance } from '@/lib/subtitleTemplates'
import { getClipTimings } from '@/lib/clipUtils'
import { ColorCorrection, COLOR_CORRECTION_DEFAULT, toFfmpegColorFilter } from '@/lib/colorPresets'

export interface ExportOptions {
  clips: Clip[]
  sources: SourceVideo[]
  outputFormat: FormatPreset | null
  clipCrops: Record<string, { x: number; y: number }>
  clipZooms: Record<string, number>
  resolution: 720 | 1080
  audioLayers: AudioLayer[]
  overlayLayers: OverlayLayer[]
  clipColorCorrections: Record<string, ColorCorrection>
  subtitleStyle: SubtitleStyle
  subtitleAppearance: SubtitleAppearance
  standardSubtitleAppearance: StandardSubtitleAppearance
  onProgress: (ratio: number) => void
}

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: await toBlobURL('/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('/ffmpeg-core.wasm', 'application/wasm'),
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
): SubEvent[] {
  const events: SubEvent[] = []
  for (const timing of timings) {
    const source = sources.find(s => s.id === timing.clip.sourceId)
    if (!source?.transcript?.length) continue
    const offset = timing.start - timing.clip.trimStart

    for (const seg of source.transcript) {
      if (seg.end <= timing.clip.trimStart || seg.start >= timing.clip.trimEnd) continue

      if (style === 'standard') {
        // One event per segment — plain text
        events.push({
          startAt: Math.max(seg.start, timing.clip.trimStart) + offset,
          endAt:   Math.min(seg.end,   timing.clip.trimEnd)   + offset,
          words: [{ word: seg.text, active: true }],
        })
      } else {
        // Highlight mode: one event per word with a 4-word sliding window (karaoke effect).
        // Uses a 10%-height strip PNG to keep decoded memory manageable (≈830KB each at 1080p).
        const words = seg.words ?? []
        if (!words.length) {
          // No word-level timestamps — fall back to segment-level
          events.push({
            startAt: Math.max(seg.start, timing.clip.trimStart) + offset,
            endAt:   Math.min(seg.end,   timing.clip.trimEnd)   + offset,
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
            startAt: Math.max(word.start, timing.clip.trimStart) + offset,
            endAt:   Math.min(word.end,   timing.clip.trimEnd)   + offset,
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const {
    clips, sources, audioLayers, overlayLayers, outputFormat, clipCrops, clipZooms,
    clipColorCorrections, resolution, subtitleStyle, subtitleAppearance,
    standardSubtitleAppearance, onProgress,
  } = opts

  let ffmpeg: FFmpeg
  try {
    ffmpeg = await getFFmpeg()
  } catch (err) {
    resetFFmpeg()
    throw new Error(`Failed to load FFmpeg: ${err instanceof Error ? err.message : err}`)
  }
  console.log('[export] FFmpeg loaded')

  const progressHandler = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)))
  const logHandler = ({ message }: { message: string }) => console.log('[ffmpeg]', message)
  ffmpeg.on('progress', progressHandler)
  ffmpeg.on('log', logHandler)

  try {
    const timings = getClipTimings(clips)
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

    // Determine output dimensions
    const targetW = outputFormat
      ? (outputFormat.aspectW >= outputFormat.aspectH ? resolution : Math.round(resolution * outputFormat.aspectW / outputFormat.aspectH))
      : resolution
    const targetH = outputFormat
      ? (outputFormat.aspectH >= outputFormat.aspectW ? resolution : Math.round(resolution * outputFormat.aspectH / outputFormat.aspectW))
      : Math.round(resolution * 9 / 16)

    // Ensure even dimensions (required by H.264)
    const outW = targetW % 2 === 0 ? targetW : targetW + 1
    const outH = targetH % 2 === 0 ? targetH : targetH + 1
    console.log(`[export] output dimensions: ${outW}x${outH}`)

    // Build subtitle events (canvas-rendered, no FFmpeg font dependency)
    const subEvents: SubEvent[] = subtitleStyle !== 'off'
      ? buildSubEvents(timings, sources, subtitleStyle as 'standard' | 'highlight')
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

      const fontSize = Math.round(outH * (ol.fontSize ?? 5) / 100)
      const fontWeight = ol.fontWeight === 'bold' ? 'bold' : 'normal'
      ctx.font = `${fontWeight} ${fontSize}px sans-serif`
      ctx.textBaseline = 'top'

      const text = ol.text ?? 'Text'
      const x = Math.round(outW * ol.x / 100)
      const y = Math.round(outH * ol.y / 100)

      if ((ol.bgOpacity ?? 0) > 0) {
        const hex = ol.bgColor ?? '#000000'
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const metrics = ctx.measureText(text)
        const pad = Math.max(4, Math.round(fontSize * 0.15))
        ctx.fillStyle = `rgba(${r},${g},${b},${ol.bgOpacity ?? 0})`
        ctx.fillRect(x - pad, y - pad, metrics.width + pad * 2, fontSize + pad * 2)
      }

      ctx.fillStyle = ol.color ?? '#ffffff'
      ctx.fillText(text, x, y)

      const pngBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
      const pngArr = new Uint8Array(await pngBlob.arrayBuffer())
      const pngFile = `text_ol_${ol.id}.png`
      await ffmpeg.writeFile(pngFile, pngArr)
      console.log(`[export] rendered text overlay "${text}" to ${pngFile} (${pngArr.length} bytes)`)

      inputArgs.push('-loop', '1', '-i', pngFile)
      textOverlayInputIndices.push(inputIdx++)
    }

    // Subtitle inputs — canvas-rendered strip PNGs (narrow height = low memory per image)
    // Highlight mode uses a narrower strip (10% vs 18%) because it generates one PNG per word.
    // At 1080p: 10% strip ≈ 830KB decoded each; 300 word-events ≈ 250MB total — fits in WASM.
    const STRIP_H = subtitleStyle === 'highlight'
      ? Math.round(outH * 0.10)
      : Math.round(outH * 0.18)
    const subEventInputIndices: number[] = []
    for (let si = 0; si < subEvents.length; si++) {
      const pngData = await renderSubEvent(subEvents[si], outW, outH, STRIP_H, subtitleStyle as 'standard' | 'highlight', standardSubtitleAppearance, subtitleAppearance)
      const pngFile = `sub_${si}.png`
      await ffmpeg.writeFile(pngFile, pngData)
      inputArgs.push('-loop', '1', '-i', pngFile)
      subEventInputIndices.push(inputIdx++)
    }
    if (subEvents.length) console.log(`[export] wrote ${subEvents.length} subtitle strip PNGs (${STRIP_H}px tall)`)

    for (let i = 0; i < timings.length; i++) {
      const timing = timings[i]
      const { clip } = timing
      const srcIdx = sourceIndexMap.get(clip.sourceId)!
      const crop = clipCrops[clip.id] ?? { x: 50, y: 50 }
      const zoom = clipZooms[clip.id] ?? 1

      const trimFilter = `[${srcIdx}:v]trim=start=${clip.trimStart}:end=${clip.trimEnd},setpts=PTS-STARTPTS`
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
      filterParts.push(`[${srcIdx}:a]atrim=start=${clip.trimStart}:end=${clip.trimEnd},asetpts=PTS-STARTPTS[atrim${i}]`)
    }

    const videoInputs = timings.map((_, i) => `[trim${i}]`).join('')
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

    // Subtitle overlays (canvas-rendered strips positioned at bottom of frame)
    subEvents.forEach((ev, si) => {
      const imgIdx = subEventInputIndices[si]
      const outLabel = `[sv${si}]`
      const t0 = ev.startAt.toFixed(3)
      const t1 = ev.endAt.toFixed(3)
      const stripY = outH - STRIP_H
      filterParts.push(`${currentV}[${imgIdx}:v]overlay=format=auto:x=0:y=${stripY}:enable='between(t,${t0},${t1})'${outLabel}`)
      currentV = outLabel
    })

    // Image overlays
    imageOverlays.forEach((ol, i) => {
      const imgIdx = imageOverlayInputIndices[i]
      const scaledW = Math.round(outW * ol.width / 100)
      const scaledLabel = `[ol_scaled_${i}]`
      const outLabel = `[ov${i}]`
      filterParts.push(`[${imgIdx}:v]scale=${scaledW}:-1${scaledLabel}`)
      const x = Math.round(outW * ol.x / 100)
      const y = Math.round(outH * ol.y / 100)
      const t0 = ol.startAt.toFixed(3)
      const t1 = (ol.startAt + ol.duration).toFixed(3)
      filterParts.push(`${currentV}${scaledLabel}overlay=x=${x}:y=${y}:enable='between(t,${t0},${t1})'${outLabel}`)
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
