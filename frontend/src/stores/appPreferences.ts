import { defineStore } from 'pinia'
import type { ColorPresetName, ThemeMode } from '@/config/vuesticPresets'

export const useAppPreferencesStore = defineStore('appPreferences', {
  state: () => ({
    locale: 'ru' as 'en' | 'ru',
    themeMode: 'system' as ThemeMode,
    colorPreset: 'blue' as ColorPresetName,
    sidebarCollapsed: false,
  }),
  persist: true,
})
