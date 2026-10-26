'use client'

import { useState, useEffect } from 'react'
import type { Provider, Feature } from '@/lib/getUserKey'

interface SavedKey {
  provider:   Provider
  maskedKey:  string
  features:   Feature[]
  ttsQuality: 'standard' | 'hd'
  updatedAt:  string
}

interface ProviderConfig {
  provider:      Provider
  name:          string
  description:   string
  features:      Feature[]
  featureLabels: Partial<Record<Feature, string>>
}

const PROVIDERS: ProviderConfig[] = [
  {
    provider:    'openai',
    name:        'OpenAI',
    description: 'Covers all features — transcription, translation, script rewrite, and voiceover TTS.',
    features:    ['transcription', 'translation', 'script', 'tts'],
    featureLabels: {
      transcription: 'Transcription',
      translation:   'Translation / CC',
      script:        'Script rewrite',
      tts:           'Voiceover TTS',
    },
  },
  {
    provider:    'groq',
    name:        'Groq',
    description: 'Faster and cheaper for transcription and text features. Does not support TTS.',
    features:    ['transcription', 'translation', 'script'],
    featureLabels: {
      transcription: 'Transcription',
      translation:   'Translation / CC',
      script:        'Script rewrite',
    },
  },
  {
    provider:    'elevenlabs',
    name:        'ElevenLabs',
    description: 'High-quality multilingual voiceover TTS.',
    features:    ['tts'],
    featureLabels: { tts: 'Voiceover TTS' },
  },
  {
    provider:    'sarvam',
    name:        'Sarvam AI',
    description: 'Indic language TTS — Tamil, Hindi, Telugu, Kannada, Malayalam, and more.',
    features:    ['tts'],
    featureLabels: { tts: 'Voiceover TTS' },
  },
]

interface EditState {
  inputKey:   string
  showInput:  boolean
  features:   Feature[]
  ttsQuality: 'standard' | 'hd'
  saving:     boolean
  removing:   boolean
  error:      string | null
  success:    boolean
}

function defaultEdit(config: ProviderConfig, saved?: SavedKey): EditState {
  return {
    inputKey:   '',
    showInput:  !saved,
    features:   saved?.features ?? config.features,
    ttsQuality: saved?.ttsQuality ?? 'standard',
    saving:     false,
    removing:   false,
    error:      null,
    success:    false,
  }
}

export default function ApiKeysPanel() {
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>([])
  const [loading, setLoading]     = useState(true)
  const [states, setStates]       = useState<Record<Provider, EditState>>(() =>
    Object.fromEntries(PROVIDERS.map(p => [p.provider, defaultEdit(p)])) as Record<Provider, EditState>
  )

  useEffect(() => {
    fetch('/api/keys')
      .then(r => r.json())
      .then((keys: SavedKey[]) => {
        setSavedKeys(keys)
        setStates(prev => {
          const next = { ...prev }
          for (const config of PROVIDERS) {
            const saved = keys.find(k => k.provider === config.provider)
            next[config.provider] = defaultEdit(config, saved)
          }
          return next
        })
      })
      .finally(() => setLoading(false))
  }, [])

  function update(provider: Provider, patch: Partial<EditState>) {
    setStates(prev => ({ ...prev, [provider]: { ...prev[provider], ...patch } }))
  }

  async function handleSave(config: ProviderConfig) {
    const s = states[config.provider]
    if (s.saving) return
    if (!s.inputKey.trim()) { update(config.provider, { error: 'Enter an API key' }); return }
    update(config.provider, { saving: true, error: null, success: false })
    try {
      const res = await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: config.provider, key: s.inputKey.trim(), features: s.features, ttsQuality: s.ttsQuality }),
      })
      const data = await res.json()
      if (!res.ok) { update(config.provider, { saving: false, error: data.error ?? 'Save failed' }); return }
      setSavedKeys(prev => [...prev.filter(k => k.provider !== config.provider), { ...data, updatedAt: new Date().toISOString() }])
      update(config.provider, { saving: false, success: true, showInput: false, inputKey: '' })
      setTimeout(() => update(config.provider, { success: false }), 3000)
    } catch (e) {
      update(config.provider, { saving: false, error: e instanceof Error ? e.message : 'Save failed' })
    }
  }

  async function handleUpdateFeatures(config: ProviderConfig) {
    const s = states[config.provider]
    if (!savedKeys.find(k => k.provider === config.provider) || s.saving) return
    update(config.provider, { saving: true, error: null })
    try {
      const res = await fetch('/api/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: config.provider, features: s.features, ttsQuality: s.ttsQuality }),
      })
      if (!res.ok) { const d = await res.json(); update(config.provider, { saving: false, error: d.error ?? 'Update failed' }); return }
      setSavedKeys(prev => prev.map(k => k.provider === config.provider ? { ...k, features: s.features, ttsQuality: s.ttsQuality } : k))
      update(config.provider, { saving: false, success: true })
      setTimeout(() => update(config.provider, { success: false }), 2000)
    } catch (e) {
      update(config.provider, { saving: false, error: e instanceof Error ? e.message : 'Update failed' })
    }
  }

  async function handleRemove(provider: Provider) {
    update(provider, { removing: true, error: null })
    try {
      await fetch('/api/keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
      setSavedKeys(prev => prev.filter(k => k.provider !== provider))
      setStates(prev => ({ ...prev, [provider]: defaultEdit(PROVIDERS.find(p => p.provider === provider)!) }))
    } catch (e) {
      update(provider, { removing: false, error: e instanceof Error ? e.message : 'Remove failed' })
    }
  }

  const hasOpenAI = savedKeys.some(k => k.provider === 'openai')
  const hasEL     = savedKeys.some(k => k.provider === 'elevenlabs')

  if (loading) return <p className="text-neutral-500 text-sm py-12 text-center">Loading…</p>

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {PROVIDERS.map(config => {
        const s        = states[config.provider]
        const saved    = savedKeys.find(k => k.provider === config.provider)
        const isTtsOnly = config.features.length === 1 && config.features[0] === 'tts'
        const showNote  = isTtsOnly && (hasOpenAI || hasEL) && saved

        return (
          <div key={config.provider} className="bg-neutral-800/60 border border-neutral-700 rounded-xl p-5 flex flex-col gap-3">
            {/* Card header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-white text-sm font-medium">{config.name}</span>
                <p className="text-xs text-neutral-400 mt-0.5">{config.description}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${saved ? 'bg-green-900/60 text-green-400' : 'bg-neutral-700 text-neutral-500'}`}>
                {saved ? '● Connected' : '○ Not set'}
              </span>
            </div>

            {/* Saved key row */}
            {saved && !s.showInput && (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-neutral-400 font-mono bg-neutral-900 rounded-lg px-3 py-2 border border-neutral-700">
                  {saved.maskedKey}
                </span>
                <button onClick={() => update(config.provider, { showInput: true })}
                  className="text-xs text-neutral-400 hover:text-white px-2.5 py-2 rounded-lg hover:bg-neutral-700 transition-colors">
                  Change
                </button>
                <button onClick={() => handleRemove(config.provider)} disabled={s.removing}
                  className="text-xs text-neutral-400 hover:text-red-400 px-2.5 py-2 rounded-lg hover:bg-red-950 transition-colors disabled:opacity-50">
                  {s.removing ? '…' : 'Remove'}
                </button>
              </div>
            )}

            {/* Key input */}
            {s.showInput && (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={s.inputKey}
                  onChange={e => update(config.provider, { inputKey: e.target.value, error: null })}
                  placeholder={`Paste your ${config.name} API key`}
                  className="flex-1 bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-400"
                />
                {saved && (
                  <button onClick={() => update(config.provider, { showInput: false, inputKey: '' })}
                    className="text-xs text-neutral-500 hover:text-white px-2.5 py-2 rounded-lg hover:bg-neutral-700 transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            )}

            {/* Feature toggles */}
            <div className={`flex flex-col gap-2 ${!saved ? 'opacity-40 pointer-events-none' : ''}`}>
              <span className="text-xs text-neutral-500 font-medium">Used for</span>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {config.features.map(feature => (
                  <label key={feature} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={s.features.includes(feature)}
                      onChange={e => update(config.provider, {
                        features: e.target.checked ? [...s.features, feature] : s.features.filter(f => f !== feature)
                      })}
                      className="accent-blue-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-neutral-300">{config.featureLabels[feature]}</span>
                  </label>
                ))}
              </div>

              {/* TTS quality — OpenAI only */}
              {config.provider === 'openai' && s.features.includes('tts') && (
                <div className="flex items-center gap-4 mt-0.5">
                  <span className="text-xs text-neutral-500">TTS quality</span>
                  {(['standard', 'hd'] as const).map(q => (
                    <label key={q} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name={`ttsq-${config.provider}`} value={q}
                        checked={s.ttsQuality === q}
                        onChange={() => update(config.provider, { ttsQuality: q })}
                        className="accent-blue-500 w-3 h-3"
                      />
                      <span className="text-xs text-neutral-300 capitalize">{q}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Supersede note */}
            {showNote && (
              <p className="text-xs text-amber-400/80 leading-relaxed">
                {config.provider === 'sarvam'
                  ? `ℹ️ Sarvam will be used for Indic language TTS, superseding ${hasEL ? 'ElevenLabs' : 'OpenAI'}.`
                  : 'ℹ️ ElevenLabs will be used for TTS, superseding OpenAI.'
                }
              </p>
            )}

            {s.error   && <p className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{s.error}</p>}
            {s.success && <p className="text-xs text-green-400 bg-green-950 border border-green-800 rounded-lg px-3 py-2">Saved successfully.</p>}

            {/* Actions */}
            <div className="flex gap-2">
              {s.showInput && (
                <button onClick={() => handleSave(config)} disabled={s.saving || !s.inputKey.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {s.saving ? 'Testing & saving…' : 'Save & Test'}
                </button>
              )}
              {!s.showInput && saved && (
                <button onClick={() => handleUpdateFeatures(config)} disabled={s.saving}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-neutral-600 text-neutral-300 hover:border-neutral-400 hover:text-white transition-colors disabled:opacity-40">
                  {s.saving ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
