// Replacement for @ffmpeg/ffmpeg's webpack-bundled 814.ffmpeg.js.
// The original bundle's fallback replaces import(url) with a webpack stub
// that always throws "Cannot find module". This version uses the browser's
// native import() — which works since this file is a static asset never
// processed by Turbopack/webpack.

let ffmpeg = null

self.onmessage = async function ({ data: { id, type, data } }) {
  const trans = []
  let result
  try {
    switch (type) {
      case 'LOAD': {
        const { coreURL, wasmURL, workerURL } = data
        const mod = await import(coreURL)
        const createFFmpegCore = mod.default ?? mod
        ffmpeg = await createFFmpegCore({
          mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({
            wasmURL:   wasmURL   ?? coreURL.replace(/\.js$/, '.wasm'),
            workerURL: workerURL ?? coreURL.replace(/\.js$/, '.worker.js'),
          }))}`,
        })
        ffmpeg.setLogger(d   => self.postMessage({ type: 'LOG',      data: d }))
        ffmpeg.setProgress(d => self.postMessage({ type: 'PROGRESS', data: d }))
        result = true
        break
      }
      case 'EXEC': {
        ffmpeg.setTimeout(data.timeout ?? -1)
        ffmpeg.exec(...data.args)
        result = ffmpeg.ret
        ffmpeg.reset()
        break
      }
      case 'FFPROBE': {
        ffmpeg.setTimeout(data.timeout ?? -1)
        ffmpeg.ffprobe(...data.args)
        result = ffmpeg.ret
        ffmpeg.reset()
        break
      }
      case 'WRITE_FILE':  ffmpeg.FS.writeFile(data.path, data.data); result = true; break
      case 'READ_FILE':   result = ffmpeg.FS.readFile(data.path, { encoding: data.encoding }); break
      case 'DELETE_FILE': ffmpeg.FS.unlink(data.path); result = true; break
      case 'RENAME':      ffmpeg.FS.rename(data.oldPath, data.newPath); result = true; break
      case 'CREATE_DIR':  ffmpeg.FS.mkdir(data.path); result = true; break
      case 'DELETE_DIR':  ffmpeg.FS.rmdir(data.path); result = true; break
      case 'LIST_DIR': {
        const names = ffmpeg.FS.readdir(data.path)
        result = names.map(name => ({
          name,
          isDir: ffmpeg.FS.isDir(ffmpeg.FS.stat(`${data.path}/${name}`).mode),
        }))
        break
      }
      case 'MOUNT': {
        const fs = ffmpeg.FS.filesystems[data.fsType]
        if (!fs) { result = false; break }
        ffmpeg.FS.mount(fs, data.options, data.mountPoint)
        result = true
        break
      }
      case 'UNMOUNT': ffmpeg.FS.unmount(data.mountPoint); result = true; break
      default: throw new Error(`Unknown message type: ${type}`)
    }
  } catch (e) {
    self.postMessage({ id, type: 'ERROR', data: String(e) })
    return
  }
  if (result instanceof Uint8Array) trans.push(result.buffer)
  self.postMessage({ id, type, data: result }, trans)
}
