// Recording state (kept in memory; offscreen document keeps SW alive during recording)
let state = {
  recording: false,
  tabId: null,
  startTime: null,
  steps: [],
  videoBuffer: null,  // ArrayBuffer from offscreen after stop
  mimeType: 'video/webm',
}

// ─── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'GET_STATE':
      sendResponse({
        recording: state.recording,
        isRecordedTab: sender.tab?.id === state.tabId,
        steps: state.steps,
        elapsed: state.startTime ? (Date.now() - state.startTime) / 1000 : 0,
      })
      return true

    case 'START_RECORDING':
      handleStart().then(sendResponse).catch(err => sendResponse({ error: err.message }))
      return true

    case 'STOP_RECORDING':
      handleStop().then(sendResponse).catch(err => sendResponse({ error: err.message }))
      return true

    case 'STEP_EVENT':
      if (state.recording && sender.tab?.id === state.tabId) {
        const offset = (Date.now() - state.startTime) / 1000
        state.steps.push({ ...msg.event, timelinePosition: offset })
      }
      return

    case 'RECORDING_DONE':
      // From offscreen: video is encoded, buffer + mimeType attached
      state.videoBuffer = msg.buffer
      state.mimeType = msg.mimeType
      state.recording = false
      ingestRecording(msg.duration).catch(console.error)
      return
  }
})

// ─── Start ───────────────────────────────────────────────────────────────────

async function handleStart() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab')

  state = {
    recording: true,
    tabId: tab.id,
    startTime: Date.now(),
    steps: [],
    videoBuffer: null,
    mimeType: 'video/webm',
  }

  // First step = current page
  state.steps.push({
    timelinePosition: 0,
    type: 'navigation',
    title: tab.title || new URL(tab.url || 'about:blank').pathname,
    url: tab.url,
  })

  // Get tab capture stream ID
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(id)
    })
  })

  // Create (or reuse) offscreen document
  const hasDoc = await chrome.offscreen.hasDocument()
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab audio and video for screen recording',
    })
  }

  // Tell offscreen to start
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', streamId })

  // Tell content script in recorded tab to start detecting events
  chrome.tabs.sendMessage(tab.id, { type: 'START_DETECTING' }).catch(() => {
    // Content script may not be injected yet (e.g. chrome:// pages) — ignore
  })

  return { ok: true }
}

// ─── Stop ────────────────────────────────────────────────────────────────────

async function handleStop() {
  if (!state.recording) return { ok: true }

  const duration = (Date.now() - state.startTime) / 1000

  // Tell content script to stop detecting
  if (state.tabId) {
    chrome.tabs.sendMessage(state.tabId, { type: 'STOP_DETECTING' }).catch(() => {})
  }

  // Tell offscreen to stop (it will send RECORDING_DONE back with the buffer)
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', duration, steps: state.steps })

  state.recording = false
  return { ok: true }
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

async function ingestRecording(duration) {
  if (!state.videoBuffer) {
    console.error('[eduser] No video buffer to ingest')
    return
  }

  // Find or open eduser tab
  const eduserTabs = await chrome.tabs.query({ url: 'http://localhost:3001/*' })
  let eduserTab = eduserTabs[0]

  if (!eduserTab) {
    eduserTab = await new Promise(resolve => {
      chrome.tabs.create({ url: 'http://localhost:3001' }, newTab => {
        chrome.tabs.onUpdated.addListener(function listener(id, info) {
          if (id === newTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener)
            resolve(newTab)
          }
        })
      })
    })
    // Give content script a moment to initialise
    await new Promise(r => setTimeout(r, 500))
  } else {
    await chrome.tabs.update(eduserTab.id, { active: true })
  }

  // Relay the recording to content script in eduser tab (same-origin → no auth/CORS issues)
  let result
  try {
    result = await chrome.tabs.sendMessage(eduserTab.id, {
      type: 'INGEST',
      buffer: state.videoBuffer,
      mimeType: state.mimeType,
      steps: state.steps,
      duration,
    })
  } catch (err) {
    console.error('[eduser] INGEST relay failed:', err)
    return
  }

  if (result?.projectId) {
    chrome.tabs.update(eduserTab.id, { url: `http://localhost:3001/editor/${result.projectId}` })
  } else {
    console.error('[eduser] Ingest returned no projectId:', result)
  }

  // Clean up
  state.videoBuffer = null
  chrome.offscreen.closeDocument().catch(() => {})
}
