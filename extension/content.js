// ─── State ───────────────────────────────────────────────────────────────────

let detecting = false
let indicator = null
let lastUrl = location.href

// On load: check if this tab is being recorded
chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
  if (chrome.runtime.lastError) return
  if (response?.recording && response?.isRecordedTab) {
    startDetecting()
    // This page load is itself a navigation event — send it
    sendStep({
      type: 'navigation',
      title: document.title || location.pathname,
      url: location.href,
    })
  }
})

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_DETECTING') {
    startDetecting()
    sendResponse({ ok: true })
    return
  }

  if (msg.type === 'STOP_DETECTING') {
    stopDetecting()
    sendResponse({ ok: true })
    return
  }

  if (msg.type === 'INGEST') {
    // Only handle on eduser (same-origin fetch works here)
    if (!location.href.startsWith('http://localhost:3001')) return
    handleIngest(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }))
    return true // async
  }
})

// ─── Event detection ─────────────────────────────────────────────────────────

function startDetecting() {
  detecting = true
  showIndicator()
  injectNavigationInterceptor()
  window.addEventListener('popstate', onPopState)
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('extension_pushstate', onPushState)
  document.addEventListener('click', onDocumentClick, true)
}

function stopDetecting() {
  detecting = false
  hideIndicator()
  window.removeEventListener('popstate', onPopState)
  window.removeEventListener('hashchange', onHashChange)
  window.removeEventListener('extension_pushstate', onPushState)
  document.removeEventListener('click', onDocumentClick, true)
}

// Inject into page context so we can intercept history.pushState / replaceState
function injectNavigationInterceptor() {
  const s = document.createElement('script')
  s.textContent = `
    ;(function() {
      const _push = history.pushState.bind(history)
      const _replace = history.replaceState.bind(history)
      function notify(url) {
        window.dispatchEvent(new CustomEvent('extension_pushstate', { detail: { url: url || location.href } }))
      }
      history.pushState = function(...a) { _push(...a); notify(a[2]) }
      history.replaceState = function(...a) { _replace(...a); notify(a[2]) }
    })()
  `
  document.documentElement.prepend(s)
  s.remove()
}

function onPopState() { checkNavigation() }
function onHashChange() { checkNavigation() }
function onPushState(e) {
  const url = e.detail?.url || location.href
  if (url !== lastUrl) {
    lastUrl = url
    sendStep({ type: 'navigation', title: document.title || location.pathname, url })
  }
}

function checkNavigation() {
  if (!detecting) return
  if (location.href !== lastUrl) {
    lastUrl = location.href
    sendStep({ type: 'navigation', title: document.title || location.pathname, url: location.href })
  }
}

// Click on significant interactive elements = new step
function onDocumentClick(e) {
  if (!detecting) return
  const el = e.target.closest(
    'button, a[href], [role="button"], [role="link"], input[type="submit"], input[type="checkbox"], input[type="radio"], select'
  )
  if (!el) return

  const text =
    el.innerText?.trim() ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.getAttribute('value') ||
    el.getAttribute('placeholder') ||
    ''

  const tag = el.tagName.toLowerCase()
  let title = ''
  if (tag === 'a') title = text ? `Clicked "${text.slice(0, 60)}"` : 'Clicked link'
  else if (text) title = `Clicked "${text.slice(0, 60)}"`
  else title = `Clicked ${el.getAttribute('aria-label') || tag}`

  sendStep({ type: 'click', title, url: location.href })
}

function sendStep(event) {
  chrome.runtime.sendMessage({ type: 'STEP_EVENT', event }).catch(() => {})
}

// ─── Recording indicator ─────────────────────────────────────────────────────

function showIndicator() {
  if (indicator) return
  indicator = document.createElement('div')
  indicator.id = '__eduser_indicator__'
  Object.assign(indicator.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: '600',
    padding: '4px 8px 4px 6px',
    borderRadius: '20px',
    pointerEvents: 'none',
    backdropFilter: 'blur(4px)',
  })
  indicator.innerHTML = `
    <span style="
      width:8px;height:8px;border-radius:50%;background:#ef4444;
      animation:__eduser_pulse__ 1.5s ease-in-out infinite;display:inline-block;flex-shrink:0
    "></span>
    REC
  `
  // Inject keyframes
  const style = document.createElement('style')
  style.textContent = `@keyframes __eduser_pulse__ { 0%,100%{opacity:1} 50%{opacity:.3} }`
  document.head?.appendChild(style)
  document.documentElement.appendChild(indicator)
}

function hideIndicator() {
  indicator?.remove()
  indicator = null
}

// ─── Ingest handler (runs only on localhost:3001) ─────────────────────────────

async function handleIngest({ buffer, mimeType, steps, duration }) {
  const videoBlob = new Blob([buffer], { type: mimeType || 'video/webm' })

  const formData = new FormData()
  formData.append('video', videoBlob, 'recording.webm')
  formData.append('steps', JSON.stringify(steps))
  formData.append('duration', String(duration))

  const res = await fetch('/api/ingest', { method: 'POST', body: formData })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ingest failed ${res.status}: ${text}`)
  }
  return res.json()
}
