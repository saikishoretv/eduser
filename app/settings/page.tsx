'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ApiKeysPanel from '@/components/editor/ApiKeysPanel'

const TABS = [
  { id: 'apis', label: 'APIs' },
] as const

type Tab = (typeof TABS)[number]['id']

const TAB_TITLES: Record<Tab, { title: string; description: string }> = {
  apis: {
    title:       'API Keys',
    description: 'Connect your own API keys. These are used instead of the app defaults and billed directly to your accounts.',
  },
}

export default function SettingsPage() {
  const router     = useRouter()
  const [tab, setTab] = useState<Tab>('apis')
  const { title, description } = TAB_TITLES[tab]

  return (
    <div className="h-screen bg-neutral-950 flex flex-col overflow-hidden">
      {/* Header — sticky */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-neutral-800 shrink-0 sticky top-0 z-10 bg-neutral-950">
        <button
          onClick={() => router.back()}
          className="text-neutral-500 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <span className="w-px h-4 bg-neutral-700" />
        <span className="text-sm font-medium text-white">Settings</span>
      </header>

      {/* Two-pane body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left pane — sticky, full height */}
        <aside className="w-48 shrink-0 border-r border-neutral-800 py-3 sticky top-0 self-start h-full overflow-y-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                tab === t.id
                  ? 'text-white bg-neutral-800 border-r-2 border-blue-500'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </aside>

        {/* Right pane — scrollable */}
        <main className="flex-1 overflow-y-auto px-10 py-8">
          <div className="mb-6">
            <h1 className="text-white font-semibold text-base">{title}</h1>
            <p className="text-neutral-400 text-sm mt-1">{description}</p>
          </div>
          <hr className="border-neutral-800 mb-6" />
          {tab === 'apis' && <ApiKeysPanel />}
        </main>

      </div>
    </div>
  )
}
