const dot        = document.getElementById('dot')
const statusText = document.getElementById('statusText')
const timer      = document.getElementById('timer')
const stepsArea  = document.getElementById('stepsArea')
const btnStart   = document.getElementById('btnStart')
const btnStop    = document.getElementById('btnStop')
const msg        = document.getElementById('msg')

let timerInterval = null

// ─── UI helpers ───────────────────────────────────────────────────────────────

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function setRecordingUI(recording, elapsed, steps) {
  if (recording) {
    dot.classList.add('recording')
    statusText.textContent = 'Recording…'
    btnStart.style.display = 'none'
    btnStop.style.display = ''
    timer.textContent = formatTime(elapsed)

    clearInterval(timerInterval)
    const t0 = Date.now() - elapsed * 1000
    timerInterval = setInterval(() => {
      timer.textContent = formatTime((Date.now() - t0) / 1000)
    }, 500)
  } else {
    dot.classList.remove('recording')
    statusText.textContent = 'Ready to record'
    btnStart.style.display = ''
    btnStop.style.display = 'none'
    timer.textContent = ''
    clearInterval(timerInterval)
  }

  stepsArea.innerHTML = ''
  const recent = (steps || []).slice(-6).reverse()
  for (const step of recent) {
    const icon = step.type === 'navigation' ? '→' : '●'
    const div = document.createElement('div')
    div.className = 'step-item'
    div.innerHTML = `<span class="step-icon">${icon}</span><span class="step-title">${escHtml(step.title)}</span>`
    stepsArea.appendChild(div)
  }
}

function showMsg(text, isError = false) {
  msg.textContent = text
  msg.className = `msg${isError ? ' error' : ''}`
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Init ─────────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
  if (chrome.runtime.lastError) {
    showMsg('Extension error — try reloading.', true)
    return
  }
  setRecordingUI(response.recording, response.elapsed || 0, response.steps)
})

// Poll for state updates every second (covers step list changes)
const pollInterval = setInterval(() => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
    if (chrome.runtime.lastError) { clearInterval(pollInterval); return }
    if (response.recording) {
      setRecordingUI(true, response.elapsed, response.steps)
    }
  })
}, 1000)

// ─── Buttons ─────────────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  btnStart.disabled = true
  showMsg('')
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, response => {
    if (chrome.runtime.lastError || response?.error) {
      showMsg(response?.error || 'Could not start recording.', true)
      btnStart.disabled = false
      return
    }
    setRecordingUI(true, 0, [])
  })
})

btnStop.addEventListener('click', () => {
  btnStop.disabled = true
  showMsg('Processing recording…')
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, response => {
    if (chrome.runtime.lastError || response?.error) {
      showMsg(response?.error || 'Stop failed.', true)
      btnStop.disabled = false
      return
    }
    showMsg('Uploading to editor…')
    setRecordingUI(false, 0, [])
  })
})
