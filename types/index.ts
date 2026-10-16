export interface TranscriptWord {
  word: string
  start: number
  end: number
}

export interface TranscriptSegment {
  text: string
  start: number  // seconds into source video
  end: number
  words: TranscriptWord[]
}

export interface SourceVideo {
  id: string
  name: string
  duration: number
  width: number
  height: number
  objectUrl: string
  isImage?: true                // set for freeze-frame still-image sources
  hasAudio?: boolean            // false when the source video has no audio track
  s3Key?: string                // set after upload; used by the DB save (T8) and cache miss handler (T6)
  transcript?: TranscriptSegment[]
  detectedLanguage?: string     // ISO 639-1 code returned by Whisper, e.g. 'en', 'hi', 'ta'
  translationLanguage?: string  // display name of the language translated to, e.g. 'Hindi'
  translatedTranscript?: TranscriptSegment[]
}

export interface ClipBackground {
  type: 'solid' | 'gradient'
  value: string  // hex color for solid, CSS gradient string for gradient
}

export interface Clip {
  id: string
  sourceId: string
  name: string
  trimStart: number // seconds into source
  trimEnd: number   // seconds into source
  background?: ClipBackground  // if set, renders a color/gradient fill (no video)
}

export interface AudioLayer {
  id: string
  name: string         // display name
  fileName: string     // original filename with extension (used by FFmpeg)
  objectUrl: string
  duration: number     // total source duration in seconds
  volume: number       // 0–1
  startAt: number      // timeline position (seconds)
  trimStart: number    // seconds into the source file
  trimEnd: number      // seconds into the source file
  trackIndex: number         // which row the clip lives on (0 = first audio row)
  fadeIn?: number            // fade-in duration in seconds (applied at clip start)
  fadeOut?: number           // fade-out duration in seconds (applied at clip end)
  s3Key?: string             // set after upload; used to regenerate objectUrl on reload
  detachedFromSourceId?: string  // set when created via detachAudio; mutes the source video in preview
}

export interface OverlayLayer {
  id: string
  type: 'image' | 'text'

  // Timeline placement
  startAt: number    // seconds into timeline
  duration: number   // seconds visible

  // Position (% of output frame, 0–100)
  x: number
  y: number
  opacity: number    // 0–1

  // Image overlay
  objectUrl?: string
  fileName?: string
  width: number      // % of frame width

  // Text overlay
  text?: string
  fontSize?: number     // % of frame height (e.g. 5 = 5%)
  fontWeight?: 'normal' | 'bold'
  color?: string        // hex
  bgColor?: string      // hex
  bgOpacity?: number    // 0–1
  borderRadius?: number // px
  borderColor?: string  // hex
  borderWidth?: number  // px
}

export interface CcWord {
  word: string
  startAt: number  // timeline seconds
  endAt: number
}

export interface CcSegment {
  id: string
  text: string
  startAt: number  // timeline seconds
  endAt: number
  words?: CcWord[]  // word-level timing for highlight mode
}

export interface ShapeLayer {
  id: string
  type: 'rectangle'
  startAt: number   // timeline seconds
  duration: number  // seconds visible
  x: number         // % of frame (center)
  y: number         // % of frame (center)
  width: number     // % of frame width
  height: number    // % of frame height
  strokeColor: string  // hex
  strokeWidth: number  // stroke width — 1 unit ≈ 1px at reference 640px preview
  strokeOpacity: number // 0–1
  borderRadius: number  // border radius — same scale as strokeWidth
  opacity: number       // overall opacity 0–1
}

export interface Step {
  id: string
  clipId: string       // references a Clip
  sourceId: string     // references a SourceVideo
  title: string
  description: string
  timelinePosition?: number  // seconds into timeline; if unset, derived from the linked clip's start
}

export interface Project {
  id: string
  name: string
  createdAt: number
  clips: Clip[]
  sources: SourceVideo[]
  audioLayers: AudioLayer[]
  overlayLayers: OverlayLayer[]
  steps?: Step[]       // present for walkthrough projects
  ccSegments?: CcSegment[]
  shapeLayers?: ShapeLayer[]
}
