export interface ColorCorrection {
  brightness: number  // -1 to 1, 0 = neutral
  contrast: number    // -1 to 1, 0 = neutral
  saturation: number  // -1 to 1, 0 = neutral
  hue: number         // -180 to 180, 0 = neutral
}

export const COLOR_CORRECTION_DEFAULT: ColorCorrection = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
}

export const COLOR_PRESETS: Array<{ name: string; values: ColorCorrection }> = [
  { name: 'Original',  values: { brightness: 0,     contrast: 0,     saturation: 0,     hue: 0   } },
  { name: 'Vivid',     values: { brightness: 0,     contrast: 0.25,  saturation: 0.5,   hue: 0   } },
  { name: 'Warm',      values: { brightness: 0.05,  contrast: 0.1,   saturation: 0.15,  hue: -20 } },
  { name: 'Cool',      values: { brightness: 0,     contrast: 0.1,   saturation: -0.1,  hue: 20  } },
  { name: 'B&W',       values: { brightness: 0,     contrast: 0.1,   saturation: -1,    hue: 0   } },
  { name: 'Vintage',   values: { brightness: -0.1,  contrast: -0.15, saturation: -0.5,  hue: -15 } },
  { name: 'Fade',      values: { brightness: 0.15,  contrast: -0.35, saturation: -0.2,  hue: 0   } },
  { name: 'Cinematic', values: { brightness: -0.05, contrast: 0.35,  saturation: -0.25, hue: 0   } },
  { name: 'Moody',     values: { brightness: -0.2,  contrast: 0.2,   saturation: -0.35, hue: 5   } },
]

/** CSS filter string for live preview in the <video> element. */
export function toCssFilter(cc: ColorCorrection): string {
  const parts: string[] = []
  const b = 1 + cc.brightness
  const c = 1 + cc.contrast
  const s = 1 + cc.saturation
  if (b !== 1) parts.push(`brightness(${b.toFixed(3)})`)
  if (c !== 1) parts.push(`contrast(${c.toFixed(3)})`)
  if (s !== 1) parts.push(`saturate(${s.toFixed(3)})`)
  if (cc.hue !== 0) parts.push(`hue-rotate(${cc.hue}deg)`)
  return parts.join(' ')
}

/**
 * FFmpeg filter chain string for a clip.
 * Uses the eq filter (brightness/contrast/saturation) and hue filter.
 * Returns '' when all values are neutral — caller should skip appending.
 */
export function toFfmpegColorFilter(cc: ColorCorrection): string {
  const parts: string[] = []
  const needsEq = cc.brightness !== 0 || cc.contrast !== 0 || cc.saturation !== 0
  if (needsEq) {
    const eqContrast   = Math.max(0, 1 + cc.contrast).toFixed(4)
    const eqSaturation = Math.max(0, 1 + cc.saturation).toFixed(4)
    parts.push(`eq=brightness=${cc.brightness.toFixed(4)}:contrast=${eqContrast}:saturation=${eqSaturation}`)
  }
  if (cc.hue !== 0) parts.push(`hue=h=${cc.hue}`)
  return parts.join(',')
}
