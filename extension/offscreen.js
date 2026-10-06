let recorder = null
let chunks = []
let stopDuration = 0
let stopSteps = []

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'OFFSCREEN_START') startRecording(msg.streamId)
  if (msg.type === 'OFFSCREEN_STOP') {
    stopDuration = msg.duration
    stopSteps = msg.steps
    stopRecording()
  }
})

async function startRecording(streamId) {
  chunks = []

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  })

  // Pick best supported codec
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm'

  recorder = new MediaRecorder(stream, { mimeType })
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType })
    const buffer = await blob.arrayBuffer()
    chrome.runtime.sendMessage({
      type: 'RECORDING_DONE',
      buffer,
      mimeType: blob.type,
      duration: stopDuration,
      steps: stopSteps,
    })
    // Stop all tracks
    stream.getTracks().forEach(t => t.stop())
  }

  recorder.start(1000) // collect chunks every second
}

function stopRecording() {
  if (recorder?.state === 'recording') recorder.stop()
}
