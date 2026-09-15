// Self-contained module worker for @ffmpeg/ffmpeg 0.12.x
// Inlines const.js + errors.js so it can be served standalone via classWorkerURL.
// Used as a module worker — supports dynamic import() of the core URL.

const FFMessageType = {
  LOAD:        'LOAD',
  EXEC:        'EXEC',
  FFPROBE:     'FFPROBE',
  WRITE_FILE:  'WRITE_FILE',
  READ_FILE:   'READ_FILE',
  DELETE_FILE: 'DELETE_FILE',
  RENAME:      'RENAME',
  CREATE_DIR:  'CREATE_DIR',
  LIST_DIR:    'LIST_DIR',
  DELETE_DIR:  'DELETE_DIR',
  ERROR:       'ERROR',
  DOWNLOAD:    'DOWNLOAD',
  PROGRESS:    'PROGRESS',
  LOG:         'LOG',
  MOUNT:       'MOUNT',
  UNMOUNT:     'UNMOUNT',
}

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error('unknown message type')
const ERROR_NOT_LOADED           = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first")
const ERROR_IMPORT_FAILURE       = new Error('failed to import ffmpeg-core.js')

let ffmpeg

// Surface any unhandled rejections as console errors so they're visible in DevTools
self.addEventListener('unhandledrejection', e => {
  console.error('[ffmpeg-worker] Unhandled rejection:', e.reason)
})

const load = async ({ coreURL, wasmURL, workerURL }) => {
  const first = !ffmpeg
  console.log('[ffmpeg-worker] LOAD start', { coreURL, wasmURL, workerURL, crossOriginIsolated })

  // Module worker — use dynamic import() directly
  console.log('[ffmpeg-worker] importing core…')
  const mod = await import(/* @vite-ignore */ coreURL)
  self.createFFmpegCore = mod.default ?? mod
  if (!self.createFFmpegCore) throw ERROR_IMPORT_FAILURE
  console.log('[ffmpeg-worker] core imported OK')

  const resolvedWasmURL   = wasmURL   ?? coreURL.replace(/\.js$/, '.wasm')
  const resolvedWorkerURL = workerURL ?? coreURL.replace(/\.js$/, '.worker.js')

  // Both @ffmpeg/core and @ffmpeg/core-mt override Module.locateFile with _locateFile,
  // which parses the base64-encoded JSON in the URL hash to find wasmURL / workerURL.
  const mainScriptUrlOrBlob = `${coreURL}#${btoa(JSON.stringify({ wasmURL: resolvedWasmURL, workerURL: resolvedWorkerURL }))}`

  // Timeout so a silent WASM-init hang surfaces as an error instead of forever blocking
  const TIMEOUT_MS = 90_000
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`createFFmpegCore timed out after ${TIMEOUT_MS / 1000}s — check WASM download and SharedArrayBuffer availability`)), TIMEOUT_MS)
  )

  console.log('[ffmpeg-worker] calling createFFmpegCore…')
  ffmpeg = await Promise.race([
    self.createFFmpegCore({ mainScriptUrlOrBlob }),
    timeout,
  ])
  console.log('[ffmpeg-worker] createFFmpegCore resolved')

  ffmpeg.setLogger(  data => self.postMessage({ type: FFMessageType.LOG,      data }))
  ffmpeg.setProgress(data => self.postMessage({ type: FFMessageType.PROGRESS, data }))
  return first
}

const exec        = ({ args, timeout = -1 }) => { ffmpeg.setTimeout(timeout); ffmpeg.exec(...args); const ret = ffmpeg.ret; ffmpeg.reset(); return ret }
const ffprobe     = ({ args, timeout = -1 }) => { ffmpeg.setTimeout(timeout); ffmpeg.ffprobe(...args); const ret = ffmpeg.ret; ffmpeg.reset(); return ret }
const writeFile   = ({ path, data })         => { ffmpeg.FS.writeFile(path, data); return true }
const readFile    = ({ path, encoding })     => ffmpeg.FS.readFile(path, { encoding })
const deleteFile  = ({ path })               => { ffmpeg.FS.unlink(path); return true }
const rename      = ({ oldPath, newPath })   => { ffmpeg.FS.rename(oldPath, newPath); return true }
const createDir   = ({ path })               => { ffmpeg.FS.mkdir(path); return true }
const deleteDir   = ({ path })               => { ffmpeg.FS.rmdir(path); return true }
const listDir     = ({ path })               => {
  const names = ffmpeg.FS.readdir(path)
  return names.map(name => ({ name, isDir: ffmpeg.FS.isDir(ffmpeg.FS.stat(`${path}/${name}`).mode) }))
}
const mount   = ({ fsType, options, mountPoint }) => { const fs = ffmpeg.FS.filesystems[fsType]; if (!fs) return false; ffmpeg.FS.mount(fs, options, mountPoint); return true }
const unmount = ({ mountPoint })                  => { ffmpeg.FS.unmount(mountPoint); return true }

self.onmessage = async ({ data: { id, type, data: _data } }) => {
  const trans = []
  let data
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED
    switch (type) {
      case FFMessageType.LOAD:        data = await load(_data); break
      case FFMessageType.EXEC:        data = exec(_data);       break
      case FFMessageType.FFPROBE:     data = ffprobe(_data);    break
      case FFMessageType.WRITE_FILE:  data = writeFile(_data);  break
      case FFMessageType.READ_FILE:   data = readFile(_data);   break
      case FFMessageType.DELETE_FILE: data = deleteFile(_data); break
      case FFMessageType.RENAME:      data = rename(_data);     break
      case FFMessageType.CREATE_DIR:  data = createDir(_data);  break
      case FFMessageType.LIST_DIR:    data = listDir(_data);    break
      case FFMessageType.DELETE_DIR:  data = deleteDir(_data);  break
      case FFMessageType.MOUNT:       data = mount(_data);      break
      case FFMessageType.UNMOUNT:     data = unmount(_data);    break
      default: throw ERROR_UNKNOWN_MESSAGE_TYPE
    }
  } catch (e) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: e.toString() })
    return
  }
  if (data instanceof Uint8Array) trans.push(data.buffer)
  self.postMessage({ id, type, data }, trans)
}
