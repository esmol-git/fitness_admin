<script setup lang="ts">
import { api } from '@/utils/api'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useToast } from 'vuestic-ui'
import {
  COLOR_PRESET_NAMES,
  COLOR_PRESET_VALUES,
  normalizeColorPreset,
  type ThemeMode,
} from '@/config/vuesticPresets'
import { useAppPreferencesStore } from '@/stores/appPreferences'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'

const { t } = useI18n()
const { init: notify } = useToast()
const prefs = useAppPreferencesStore()
const { colorPreset, locale, themeMode } = storeToRefs(prefs)

const saving = ref(false)
const error = ref<string | null>(null)
const draft = ref({
  locale: locale.value,
  preset: colorPreset.value,
  themeMode: themeMode.value,
})

const themeOptions = computed(() => [
  { text: t('settings.themeLight'), value: 'light' },
  { text: t('settings.themeDark'), value: 'dark' },
  { text: t('settings.themeSystem'), value: 'system' },
])

const localeOptions = computed(() => [
  { text: t('settings.localeRu'), value: 'ru' },
  { text: t('settings.localeEn'), value: 'en' },
])

const presetItems = computed(() =>
  COLOR_PRESET_NAMES.map((name) => ({
    name,
    color: COLOR_PRESET_VALUES[name],
    label: t(`settings.presets.${name}`),
  })),
)

function onLocale(value: unknown) {
  if (value === 'ru' || value === 'en') {
    draft.value.locale = value
    locale.value = value
  }
}

function onPreset(value: unknown) {
  if (typeof value === 'string') {
    draft.value.preset = normalizeColorPreset(value)
    colorPreset.value = draft.value.preset
  }
}

function onThemeMode(value: unknown) {
  if (value === 'light' || value === 'dark' || value === 'system') {
    draft.value.themeMode = value as ThemeMode
    themeMode.value = value
  }
}

async function saveSettings() {
  saving.value = true
  error.value = null
  try {
    await api.patch('/settings/me', {
      locale: draft.value.locale,
      preset: draft.value.preset,
      themeMode: draft.value.themeMode.toUpperCase(),
    })
    locale.value = draft.value.locale
    colorPreset.value = draft.value.preset
    themeMode.value = draft.value.themeMode
    notify({ color: 'success', message: t('settings.saved') })
  } catch (e: unknown) {
    error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('settings.saveFailed'),
      byCode: {
        SETTINGS_USER_NOT_FOUND: t('settings.saveFailed'),
      },
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl">
    <VaCard class="settings-card rounded-2xl border-0">
      <VaCardTitle class="text-lg font-semibold">
        {{ t('settings.title') }}
      </VaCardTitle>
      <VaCardContent class="settings-content">
        <section class="setting-section">
          <h3 class="setting-title">{{ t('settings.theme') }}</h3>
          <p class="setting-hint">{{ t('settings.themeHint') }}</p>
          <VaSelect
            :model-value="draft.themeMode"
            :options="themeOptions"
            value-by="value"
            text-by="text"
            class="mt-4 w-full max-w-xl"
            @update:model-value="onThemeMode"
          />
        </section>

        <section class="setting-section">
          <h3 class="setting-title">{{ t('settings.language') }}</h3>
          <p class="setting-hint">{{ t('settings.languageHint') }}</p>
          <VaSelect
            :model-value="draft.locale"
            :options="localeOptions"
            value-by="value"
            text-by="text"
            class="mt-4 w-full max-w-sm"
            @update:model-value="onLocale"
          />
        </section>

        <section class="setting-section">
          <h3 class="setting-title">{{ t('settings.accent') }}</h3>
          <p class="setting-hint">{{ t('settings.accentHint') }}</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              v-for="item in presetItems"
              :key="item.name"
              type="button"
              class="preset-chip"
              :style="{
                borderColor: draft.preset === item.name ? 'var(--app-accent)' : 'var(--app-border)',
                boxShadow:
                  draft.preset === item.name
                    ? '0 0 0 3px color-mix(in srgb, var(--app-accent) 25%, transparent)'
                    : 'none',
              }"
              @click="onPreset(item.name)"
            >
              <span class="preset-dot" :style="{ backgroundColor: item.color }" />
              {{ item.label }}
            </button>
          </div>
        </section>

        <VaAlert v-if="error" color="danger" outline class="settings-alert">{{ error }}</VaAlert>

        <div class="settings-actions">
          <VaButton class="settings-save-btn" :loading="saving" icon="save" @click="saveSettings">
            {{ t('settings.save') }}
          </VaButton>
        </div>
      </VaCardContent>
    </VaCard>
  </div>
</template>

<style scoped>
.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--app-page-gap);
}

.setting-section {
  border: 1px solid var(--app-border);
  border-radius: var(--app-card-radius);
  padding: var(--app-modal-padding);
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-bg-end));
}

.setting-title {
  color: var(--app-text);
  font-size: 1.05rem;
  font-weight: 700;
}

.setting-hint {
  margin-top: 0.35rem;
  color: var(--app-muted);
  font-size: 0.95rem;
}

.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  padding: 0.5rem 0.8rem;
  color: var(--app-text);
  background: var(--app-surface);
  transition: all 0.18s ease;
}

.preset-chip:hover {
  transform: translateY(-1px);
  border-color: var(--app-accent);
}

.preset-dot {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 9999px;
  flex-shrink: 0;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.4rem;
}

.settings-actions :deep(.va-button) {
  min-height: var(--app-action-height);
}

.settings-alert {
  width: 100%;
  margin-top: 0.15rem;
}

.settings-save-btn {
  min-width: 210px;
  min-height: var(--app-control-height-lg);
}

@media (max-width: 760px) {
  .settings-actions {
    justify-content: stretch;
  }

  .settings-save-btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
