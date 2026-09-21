'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp, useSession } from '@/lib/auth-client'

type Tab = 'signin' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const { data: session } = useSession()

  const [tab, setTab]           = useState<Tab>('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (session) router.replace('/')
  }, [session, router])

  function switchTab(next: Tab) {
    setTab(next)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (tab === 'signin') {
      const { error: err } = await signIn.email({ email, password })
      if (err) { setError(err.message ?? 'Sign in failed'); setLoading(false); return }
      router.replace('/')
    } else {
      const { error: err } = await signUp.email({ email, password, name: email.split('@')[0] })
      if (err) { setError(err.message ?? 'Sign up failed'); setLoading(false); return }
      router.replace('/')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-white text-2xl font-semibold tracking-tight">Clipr</span>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="flex border-b border-neutral-800">
            {(['signin', 'signup'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {t === 'signin' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-neutral-400">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 rounded-lg px-3 py-2 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-neutral-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  minLength={tab === 'signup' ? 8 : undefined}
                  className="bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 rounded-lg px-3 py-2 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {loading
                  ? tab === 'signin' ? 'Signing in…' : 'Creating account…'
                  : tab === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
