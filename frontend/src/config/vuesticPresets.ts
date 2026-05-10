export const COLOR_PRESET_NAMES = [
  'green',
  'blue',
  'purple',
  'red',
  'orange',
  'cyan',
] as const

export type ColorPresetName = (typeof COLOR_PRESET_NAMES)[number]
export type ThemeMode = 'light' | 'dark' | 'system'

export const COLOR_PRESET_VALUES: Record<ColorPresetName, string> = {
  green: '#059669',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  red: '#F43F5E',
  orange: '#D97706',
  cyan: '#0891B2',
}

const LEGACY_PRESET_ALIASES: Record<string, ColorPresetName> = {
  amber: 'orange',
  pink: 'red',
}

export function normalizeColorPreset(value: string | null | undefined): ColorPresetName {
  if (!value) return 'blue'
  if ((COLOR_PRESET_NAMES as readonly string[]).includes(value)) {
    return value as ColorPresetName
  }
  if (LEGACY_PRESET_ALIASES[value]) {
    return LEGACY_PRESET_ALIASES[value]
  }
  return 'blue'
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } {
  const hex = hexColor.replace('#', '')
  const normalized = hex.length === 3 ? hex.split('').map((char) => `${char}${char}`).join('') : hex
  const int = Number.parseInt(normalized, 16)
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixHex(base: string, withColor: string, ratio: number): string {
  const a = hexToRgb(base)
  const b = hexToRgb(withColor)
  const p = Math.max(0, Math.min(1, ratio))
  return rgbToHex(a.r * (1 - p) + b.r * p, a.g * (1 - p) + b.g * p, a.b * (1 - p) + b.b * p)
}

function readableTextColor(bg: string): string {
  const { r, g, b } = hexToRgb(bg)
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  return luma > 170 ? '#111827' : '#ffffff'
}

export function buildVuesticAccentColors(name: ColorPresetName): Record<string, string> {
  const preset = normalizeColorPreset(name)
  const accent = COLOR_PRESET_VALUES[preset]
  return {
    primary: accent,
    info: accent,
    focus: accent,
    secondary: mixHex(accent, '#ffffff', 0.14),
    onPrimary: readableTextColor(accent),
    onInfo: readableTextColor(accent),
  }
}

export function applyAccentPreset(name: ColorPresetName): void {
  const preset = normalizeColorPreset(name)
  const value = COLOR_PRESET_VALUES[preset]
  const root = document.documentElement
  root.dataset.accent = preset
  root.style.setProperty('--va-primary', value)
  root.style.setProperty('--va-info', value)
  root.style.setProperty('--va-secondary', mixHex(value, '#ffffff', 0.14))
  root.style.setProperty('--va-focus', value)
  root.style.setProperty('--app-accent', value)
}

export function applyThemeMode(mode: ThemeMode, prefersDark: boolean): void {
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = resolved
}
