export interface FormatPreset {
  id: string
  label: string
  platform: string
  aspectW: number
  aspectH: number
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'ig-reels',    label: 'Reels / Stories', platform: 'Instagram', aspectW: 9,  aspectH: 16 },
  { id: 'ig-portrait', label: 'Feed Portrait',   platform: 'Instagram', aspectW: 4,  aspectH: 5  },
  { id: 'ig-square',   label: 'Feed Square',     platform: 'Instagram', aspectW: 1,  aspectH: 1  },
  { id: 'yt-standard', label: 'Standard',        platform: 'YouTube',   aspectW: 16, aspectH: 9  },
  { id: 'yt-shorts',   label: 'Shorts',          platform: 'YouTube',   aspectW: 9,  aspectH: 16 },
]

export const PLATFORMS = ['Instagram', 'YouTube'] as const
