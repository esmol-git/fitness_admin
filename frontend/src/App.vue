<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useColors, useToast } from 'vuestic-ui'
import { api } from '@/utils/api'
import { LOCALE_MESSAGES } from '@/plugins/i18n'
import {
  applyAccentPreset,
  applyThemeMode,
  buildVuesticAccentColors,
  normalizeColorPreset,
} from '@/config/vuesticPresets'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { useAppPreferencesStore } from '@/stores/appPreferences'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
/**
 * Без сайдбара: логин (guest), meta.standaloneLayout (напр. 404 для авторизованных).
 * guestOnly в первом кадре стабильнее, чем имя маршрута.
 */
const minimalShell = computed(
  () =>
    Boolean(route.meta.guestOnly) ||
    route.name === 'login' ||
    Boolean(route.meta.standaloneLayout),
)

const auth = useAuthStore()
const prefs = useAppPreferencesStore()
const { setColors } = useColors()
const { sidebarCollapsed } = storeToRefs(prefs)
const { locale, t } = useI18n()
const ui = useUiStore()
const { init: notify } = useToast()
const prefersDark = ref(
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,
)
const appearanceReady = ref(false)

let mediaQuery: MediaQueryList | null = null
let mediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null

const dark = computed(() => {
  if (prefs.themeMode === 'dark') return true
  if (prefs.themeMode === 'light') return false
  return prefersDark.value
})

const vuesticI18n = computed(() => LOCALE_MESSAGES[prefs.locale].vuestic ?? {})
const dateLocale = computed(() => (prefs.locale === 'ru' ? 'ru-RU' : 'en-US'))

function buildMonthNames(localeCode: string) {
  const formatter = new Intl.DateTimeFormat(localeCode, { month: 'short' })
  return Array.from({ length: 12 }, (_, month) => {
    const label = formatter.format(new Date(Date.UTC(2024, month, 1)))
    return label.replace('.', '').trim()
  })
}

function buildWeekdayNames(localeCode: string) {
  const formatter = new Intl.DateTimeFormat(localeCode, { weekday: 'short' })
  const sunday = Date.UTC(2024, 0, 7)
  return Array.from({ length: 7 }, (_, offset) => {
    const label = formatter.format(new Date(sunday + offset * 24 * 60 * 60 * 1000))
    return label.replace('.', '').trim()
  })
}

const vuesticComponentsConfig = computed(() => ({
  VaDateInput: {
    monthNames: buildMonthNames(dateLocale.value),
    weekdayNames: buildWeekdayNames(dateLocale.value),
    firstWeekday: (prefs.locale === 'ru' ? 'monday' : 'sunday') as 'monday' | 'sunday',
  },
}))

async function loadPreferences() {
  if (!auth.accessToken) {
    appearanceReady.value = true
    return
  }
  try {
    const { data } = await api.get<{
      themeMode: 'LIGHT' | 'DARK' | 'SYSTEM'
      preset: string
      locale: 'ru' | 'en'
    }>('/settings/me')

    prefs.themeMode = data.themeMode.toLowerCase() as 'light' | 'dark' | 'system'
    prefs.colorPreset = normalizeColorPreset(data.preset)
    prefs.locale = data.locale
  } finally {
    appearanceReady.value = true
  }
}

onMounted(async () => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  prefersDark.value = mediaQuery.matches
  mediaQueryListener = (event: MediaQueryListEvent) => {
    prefersDark.value = event.matches
  }
  mediaQuery.addEventListener('change', mediaQueryListener)
  await loadPreferences()
})

onBeforeUnmount(() => {
  if (mediaQuery && mediaQueryListener) {
    mediaQuery.removeEventListener('change', mediaQueryListener)
  }
})

watch(
  () => prefs.locale,
  (code) => {
    locale.value = code
  },
  { immediate: true },
)

watch(
  () => ui.pendingNotice,
  (kind) => {
    if (kind === 'forbidden') {
      notify({ color: 'warning', message: t('router.forbidden') })
      ui.clearPendingNotice()
    } else if (kind === 'network') {
      notify({ color: 'danger', message: t('common.networkError') })
      ui.clearPendingNotice()
    }
  },
)

watch(
  () => prefs.colorPreset,
  (preset) => {
    applyAccentPreset(preset)
    setColors(buildVuesticAccentColors(preset))
  },
  { immediate: true },
)

watch(
  [() => prefs.themeMode, prefersDark],
  ([mode, mediaPrefersDark]) => {
    applyThemeMode(mode, mediaPrefersDark)
  },
  { immediate: true },
)
</script>

<template>
  <VaConfig :dark="dark" :i18n="vuesticI18n" :components="vuesticComponentsConfig">
    <div v-if="!appearanceReady" class="app-preloader">
      <VaInnerLoading :loading="true" size="large" />
    </div>
    <div v-else class="app-root">
      <AppHeader :compact="minimalShell" />
      <div v-if="!minimalShell" class="app-body">
        <AppSidebar
          :collapsed="sidebarCollapsed"
          @toggle="sidebarCollapsed = !sidebarCollapsed"
        />
        <main class="main">
          <RouterView />
        </main>
      </div>
      <main v-else class="main main--minimal">
        <RouterView />
      </main>
    </div>
  </VaConfig>
</template>

<style scoped>
.app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--app-bg-start) 0%, var(--app-bg-end) 100%);
  padding: 0.35rem 0.75rem 0.75rem;
  gap: 0.75rem;
  overflow: hidden;
}

.app-preloader {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-bg-start);
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 0.75rem;
  overflow: hidden;
}

.main {
  flex: 1;
  padding: 0;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.main--minimal {
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 960px) {
  .app-body {
    flex-direction: column;
  }
}
</style>
