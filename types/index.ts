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
  objectUrl: string
  transcript?: TranscriptSegment[]
}

export interface Clip {
  id: string
  sourceId: string
  name: string
  trimStart: number // seconds into source
  trimEnd: number   // seconds into source
}

export interface AudioLayer {
  id: string
  name: string         // display name
  fileName: string     // original filename with extension (used by FFmpeg)
  objectUrl: string
  blobId?: string      // IndexedDB key; defaults to id. Detached audio reuses the source video's id.
  duration: number     // total source duration in seconds
  volume: number       // 0–1
  startAt: number      // timeline position (seconds)
  trimStart: number    // seconds into the source file
  trimEnd: number      // seconds into the source file
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
  blobId?: string
  fileName?: string
  width: number      // % of frame width

  // Text overlay
  text?: string
  fontSize?: number  // % of frame height (e.g. 5 = 5%)
  fontWeight?: 'normal' | 'bold'
  color?: string     // hex
  bgColor?: string   // hex
  bgOpacity?: number // 0–1
}

export interface Project {
  id: string
  name: string
  createdAt: number
  clips: Clip[]
  sources: SourceVideo[]
  audioLayers: AudioLayer[]
  overlayLayers: OverlayLayer[]
}
