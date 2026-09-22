'use client'

export interface RecorderOptions {
  onStop: (blob: Blob, mimeType: string) => void
}

export class ScreenRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType: string = ''

  // Returns true if the browser supports screen recording
  static isSupported(): boolean {
    return !!(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices)
  }

  // Pick the best supported mime type
  static preferredMimeType(): string {
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return ''
  }

  async start(): Promise<void> {
    if (this.recorder) throw new Error('Already recording')

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    })

    this.mimeType = ScreenRecorder.preferredMimeType()
    this.chunks = []

    this.recorder = new MediaRecorder(this.stream, {
      ...(this.mimeType ? { mimeType: this.mimeType } : {}),
    })

    this.recorder.ondataavailable = e => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }

    // Collect data every second so we don't lose too much on a crash
    this.recorder.start(1000)

    // If user stops screen share from the browser UI, treat it as stop
    this.stream.getVideoTracks()[0].addEventListener('ended', () => this.stop())
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        reject(new Error('Not recording'))
        return
      }

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: this.mimeType || 'video/webm',
        })
        this.cleanup()
        resolve(blob)
      }

      this.recorder.stop()
    })
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  private cleanup() {
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}
