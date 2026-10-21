// Client-side video compression using FFmpeg WASM (same loader as export.ts)
// Skips files that are already small enough.

const COMPRESS_THRESHOLD = 80 * 1024 * 1024 // 80 MB — skip if smaller

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegInstance: any = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFFmpeg(): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance
  await loadScript('/ffmpeg.js')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { FFmpeg } = (window as any).FFmpegWASM
  const ffmpeg = new FFmpeg()
  const base = window.location.origin
  await ffmpeg.load({
    classWorkerURL: `${base}/ffmpeg-worker.js`,
    coreURL: `${base}/ffmpeg-core-st.js`,
    wasmURL: `${base}/ffmpeg-core-st.wasm`,
  })
  ffmpegInstance = ffmpeg
  return ffmpeg
}

/**
 * Compresses a video file client-side before upload.
 * - Files ≤ 80 MB are returned as-is.
 * - Encodes with H.264 CRF 23, caps the longer edge at 1920 px, AAC 128k audio.
 * - Returns a new File with type "video/mp4".
 */
export async function compressVideo(
  file: File,
  onProgress: (ratio: number) => void,
): Promise<File> {
  if (file.size <= COMPRESS_THRESHOLD) return file

  const ffmpeg = await getFFmpeg()

  // Report encoding progress (FFmpeg fires progress events with ratio 0–1)
  ffmpeg.on('progress', ({ progress }: { progress: number }) => {
    onProgress(Math.min(1, Math.max(0, progress)))
  })

  const inputName = 'input_compress.' + (file.name.split('.').pop() ?? 'mp4')
  const outputName = 'output_compress.mp4'

  // Write input
  const inputBytes = new Uint8Array(await file.arrayBuffer())
  await ffmpeg.writeFile(inputName, inputBytes)

  // Scale: cap longer edge at 1920, keep aspect ratio, ensure even dims for H.264
  const scaleFilter =
    "scale='if(gt(iw,ih),min(iw,1920),-2)':'if(gt(iw,ih),-2,min(ih,1920))',scale=trunc(iw/2)*2:trunc(ih/2)*2"

  await ffmpeg.exec([
    '-i', inputName,
    '-vf', scaleFilter,
    '-c:v', 'libx264',
    '-crf', '23',
    '-preset', 'fast',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    outputName,
  ])

  const data: Uint8Array = await ffmpeg.readFile(outputName)

  // Cleanup
  await ffmpeg.deleteFile(inputName).catch(() => {})
  await ffmpeg.deleteFile(outputName).catch(() => {})

  // Remove progress listener
  ffmpeg.off('progress')

  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([data.buffer as ArrayBuffer], `${baseName}.mp4`, { type: 'video/mp4' })
}
