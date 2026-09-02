export interface StandardSubtitleAppearance {
  preset: string    // preset id or 'custom'
  textColor: string // hex #rrggbb
  bgColor: string   // hex #rrggbb
  bgOpacity: number // 0–1
}

export interface SubtitleAppearance {
  preset: string        // preset id or 'custom'
  highlightColor: string  // hex #rrggbb — active word
  inactiveColor: string   // hex #rrggbb — surrounding words
  inactiveOpacity: number // 0–1
  bgColor: string         // hex #rrggbb
  bgOpacity: number       // 0–1 (0 = no background)
}

// ─── Standard presets ────────────────────────────────────────────────────────

export interface StandardPreset {
  id: string
  label: string
  value: Omit<StandardSubtitleAppearance, 'preset'>
}

export const STANDARD_PRESETS: StandardPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    value: { textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0.75 },
  },
  {
    id: 'soft',
    label: 'Soft',
    value: { textColor: '#ffffff', bgColor: '#1a1a1a', bgOpacity: 0.85 },
  },
  {
    id: 'light',
    label: 'Light',
    value: { textColor: '#111111', bgColor: '#ffffff', bgOpacity: 0.88 },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    value: { textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0 },
  },
  {
    id: 'yellow',
    label: 'Yellow',
    value: { textColor: '#ffe000', bgColor: '#000000', bgOpacity: 0 },
  },
]

export const STANDARD_SUBTITLE_DEFAULT: StandardSubtitleAppearance = {
  preset: 'classic',
  ...STANDARD_PRESETS[0].value,
}

// ─── Highlight presets ────────────────────────────────────────────────────────

export interface HighlightPreset {
  id: string
  label: string
  value: Omit<SubtitleAppearance, 'preset'>
}

export const HIGHLIGHT_PRESETS: HighlightPreset[] = [
  {
    id: 'karaoke',
    label: 'Karaoke',
    value: { highlightColor: '#ffe000', inactiveColor: '#ffffff', inactiveOpacity: 0.5, bgColor: '#000000', bgOpacity: 0.8 },
  },
  {
    id: 'clean-dark',
    label: 'Clean dark',
    value: { highlightColor: '#ffffff', inactiveColor: '#ffffff', inactiveOpacity: 0.45, bgColor: '#000000', bgOpacity: 0.8 },
  },
  {
    id: 'clean-light',
    label: 'Clean light',
    value: { highlightColor: '#111111', inactiveColor: '#111111', inactiveOpacity: 0.4, bgColor: '#ffffff', bgOpacity: 0.9 },
  },
  {
    id: 'neon',
    label: 'Neon',
    value: { highlightColor: '#00e5ff', inactiveColor: '#ffffff', inactiveOpacity: 0.4, bgColor: '#000000', bgOpacity: 0.8 },
  },
  {
    id: 'text-only',
    label: 'Text only',
    value: { highlightColor: '#ffe000', inactiveColor: '#ffffff', inactiveOpacity: 0.35, bgColor: '#000000', bgOpacity: 0 },
  },
]

export const SUBTITLE_DEFAULT: SubtitleAppearance = {
  preset: 'karaoke',
  ...HIGHLIGHT_PRESETS[0].value,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${opacity})`
}
