'use client'

import { useRef, useEffect } from 'react'

interface Props {
  value: string
  onChange: (html: string) => void
}

function getSelectedHtml(): string {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return ''
  const div = document.createElement('div')
  div.appendChild(sel.getRangeAt(0).cloneContents())
  return div.innerHTML
}

export default function RichTextEditor({ value, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)

  // Sync value into DOM only when not focused (prevents cursor jump mid-type)
  useEffect(() => {
    const el = editorRef.current
    if (!el || document.activeElement === el) return
    if (el.innerHTML !== value) el.innerHTML = value
  }, [value])

  function emit() {
    onChange(editorRef.current?.innerHTML ?? '')
  }

  function exec(cmd: string, val?: string) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val)
    emit()
  }

  function applySize(em: number) {
    editorRef.current?.focus()
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const html = getSelectedHtml()
    document.execCommand('insertHTML', false, `<span style="font-size:${em}em">${html}</span>`)
    emit()
  }

  return (
    <div className="flex flex-col gap-1 shrink-0">
      {/* Mini format toolbar */}
      <div className="flex items-center gap-0.5">
        <button
          onMouseDown={e => { e.preventDefault(); exec('bold') }}
          aria-label="Bold"
          className="w-5 h-5 flex items-center justify-center rounded text-[11px] font-bold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          B
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); exec('italic') }}
          aria-label="Italic"
          className="w-5 h-5 flex items-center justify-center rounded text-[11px] italic text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          I
        </button>
        <div className="w-px h-3 bg-neutral-700 mx-0.5" />
        <button
          onMouseDown={e => { e.preventDefault(); applySize(0.75) }}
          aria-label="Small text"
          className="px-1 h-5 flex items-center justify-center rounded text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          S
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); applySize(1) }}
          aria-label="Normal text"
          className="px-1 h-5 flex items-center justify-center rounded text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          M
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); applySize(1.4) }}
          aria-label="Large text"
          className="px-1 h-5 flex items-center justify-center rounded text-[12px] text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          L
        </button>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Text content"
        onInput={emit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            document.execCommand('insertLineBreak')
          }
        }}
        className="w-32 min-h-[38px] bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-neutral-500 leading-snug"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      />
    </div>
  )
}
