<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { pickerValueToIsoYmd, toDateValue } from '@/utils/ruDateInput'
import {
  parseRangePickerValue,
  resolveInitialDateFilterMode,
  toRangePickerModel,
  type DateRangeFilterMode,
} from '@/utils/dateRangeFilter'

export type DateRangeFieldChoice = {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    label: string
    dayPlaceholder?: string
    rangePlaceholder?: string
    dayModeLabel?: string
    rangeModeLabel?: string
    inputClass?: string
    /** Переключатель: по какому полю фильтровать период */
    dateFieldChoices?: DateRangeFieldChoice[]
    dateFieldAriaLabel?: string
    /** «input» — День/Период справа от поля (для выравнивания с VaInput/VaSelect в тулбаре) */
    modeTogglePosition?: 'head' | 'input'
    /** Не рисовать подпись (если задана снаружи) */
    hideLabel?: boolean
  }>(),
  {
    inputClass: 'app-date-range-filter__input',
    modeTogglePosition: 'head',
    hideLabel: false,
  },
)

const from = defineModel<string>('from', { default: '' })
const to = defineModel<string>('to', { default: '' })
const dateField = defineModel<string>('dateField', { default: '' })

const emit = defineEmits<{
  change: []
  cleared: []
}>()

const { t } = useI18n()

const mode = ref<DateRangeFilterMode>(resolveInitialDateFilterMode(from.value, to.value))
const rangePendingFrom = ref('')

watch([from, to], ([f, tVal]) => {
  if (f && f === tVal) {
    if (mode.value === 'range' && !rangePendingFrom.value) {
      mode.value = 'day'
    }
    return
  }
  if (f || tVal) {
    mode.value = 'range'
  }
})

const dayModeText = computed(() => props.dayModeLabel ?? t('common.dateFilterDay'))
const rangeModeText = computed(() => props.rangeModeLabel ?? t('common.dateFilterRange'))
const dayPlaceholderText = computed(() => props.dayPlaceholder ?? t('common.dateFilterDayPlaceholder'))
const rangePlaceholderText = computed(
  () => props.rangePlaceholder ?? t('common.dateFilterRangePlaceholder'),
)

const showDateFieldSwitch = computed(() => (props.dateFieldChoices?.length ?? 0) > 1)

const dateFieldAria = computed(
  () => props.dateFieldAriaLabel ?? props.label,
)

function setDateField(next: string) {
  if (dateField.value === next) return
  dateField.value = next
  emit('change')
}

const singleDayValue = computed(() => {
  const day = from.value || to.value || ''
  if (!day) return undefined
  return toDateValue(day)
})

const rangeValue = computed(() => toRangePickerModel(from.value, to.value, rangePendingFrom.value))

function setMode(next: DateRangeFilterMode) {
  if (mode.value === next) return
  rangePendingFrom.value = ''
  mode.value = next
  if (next === 'day') {
    const day = from.value || to.value || ''
    if (day) {
      from.value = day
      to.value = day
      emit('change')
    }
  }
}

function onSingleDay(value: unknown) {
  rangePendingFrom.value = ''
  if (value == null || value === '' || value === false) {
    from.value = ''
    to.value = ''
    emit('cleared')
    return
  }
  const day = pickerValueToIsoYmd(value)
  if (!day) return
  from.value = day
  to.value = day
  emit('change')
}

function onRange(value: unknown) {
  const parsed = parseRangePickerValue(value, rangePendingFrom.value)
  if (parsed == null) return

  if (parsed.type === 'cleared') {
    rangePendingFrom.value = ''
    from.value = ''
    to.value = ''
    emit('cleared')
    return
  }

  if (parsed.type === 'pending') {
    rangePendingFrom.value = parsed.from
    return
  }

  rangePendingFrom.value = ''
  from.value = parsed.from
  to.value = parsed.to
  emit('change')
}
</script>

<template>
  <div
    class="app-date-range-filter"
    :class="{ 'app-date-range-filter--mode-input': modeTogglePosition === 'input' }"
  >
    <div v-if="!hideLabel && modeTogglePosition === 'head'" class="app-date-range-filter__head">
      <span class="app-date-range-filter__label">{{ label }}</span>
      <div class="app-date-range-filter__mode" role="group" :aria-label="label">
        <button
          type="button"
          class="app-date-range-filter__seg"
          :class="{ 'app-date-range-filter__seg--active': mode === 'day' }"
          @click="setMode('day')"
        >
          {{ dayModeText }}
        </button>
        <button
          type="button"
          class="app-date-range-filter__seg"
          :class="{ 'app-date-range-filter__seg--active': mode === 'range' }"
          @click="setMode('range')"
        >
          {{ rangeModeText }}
        </button>
      </div>
    </div>
    <span v-else-if="!hideLabel" class="app-date-range-filter__label app-date-range-filter__label--solo">{{
      label
    }}</span>
    <div class="app-date-range-filter__input-row">
      <VaDateInput
        v-if="mode === 'day'"
        key="date-filter-day"
        :model-value="singleDayValue"
        mode="single"
        clearable
        :placeholder="dayPlaceholderText"
        :class="[inputClass, 'app-date-range-filter__input-field']"
        @update:model-value="onSingleDay"
      />
      <VaDateInput
        v-else
        key="date-filter-range"
        :model-value="rangeValue"
        mode="range"
        clearable
        :placeholder="rangePlaceholderText"
        :class="[inputClass, 'app-date-range-filter__input-field']"
        @update:model-value="onRange"
      />
      <div
        v-if="modeTogglePosition === 'input'"
        class="app-date-range-filter__mode"
        role="group"
        :aria-label="label"
      >
        <button
          type="button"
          class="app-date-range-filter__seg"
          :class="{ 'app-date-range-filter__seg--active': mode === 'day' }"
          @click="setMode('day')"
        >
          {{ dayModeText }}
        </button>
        <button
          type="button"
          class="app-date-range-filter__seg"
          :class="{ 'app-date-range-filter__seg--active': mode === 'range' }"
          @click="setMode('range')"
        >
          {{ rangeModeText }}
        </button>
      </div>
    </div>
    <div
      v-if="showDateFieldSwitch"
      class="app-date-range-filter__field-row"
      role="group"
      :aria-label="dateFieldAria"
    >
      <button
        v-for="choice in props.dateFieldChoices"
        :key="choice.value"
        type="button"
        class="app-date-range-filter__field-seg"
        :class="{ 'app-date-range-filter__field-seg--active': dateField === choice.value }"
        @click="setDateField(choice.value)"
      >
        {{ choice.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-date-range-filter {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.app-date-range-filter__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  min-width: 0;
}
.app-date-range-filter__label {
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  line-height: 1.35;
  font-weight: 600;
  color: var(--app-muted);
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-date-range-filter__mode {
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 1.65rem;
  padding: 0.12rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
}
.app-date-range-filter__seg {
  min-width: 2.65rem;
  min-height: 1.4rem;
  padding: 0.1rem 0.45rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 68%, var(--app-muted));
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}
.app-date-range-filter__seg:hover:not(.app-date-range-filter__seg--active) {
  background: color-mix(in srgb, var(--app-text) 5%, transparent);
  color: var(--app-text);
}
.app-date-range-filter__seg--active {
  color: #fff;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 88%, white 12%) 0%,
    color-mix(in srgb, var(--app-accent) 74%, black 26%) 100%
  );
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-accent) 24%, transparent);
}
.app-date-range-filter__seg:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 1px;
}
.app-date-range-filter__input-row {
  display: flex;
  align-items: stretch;
  gap: 0.45rem;
  min-width: 0;
  width: 100%;
}

.app-date-range-filter__input-field {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  max-width: none;
}

.app-date-range-filter__input-field :deep(.va-input-label) {
  display: none;
}

.app-date-range-filter__input-field :deep(.va-input-wrapper) {
  margin-top: 0;
}

.app-date-range-filter--mode-input .app-date-range-filter__label--solo {
  display: block;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  line-height: 1.35;
  font-weight: 600;
  color: var(--app-muted);
  min-height: 1.35rem;
  margin-bottom: 0.05rem;
}

.app-date-range-filter--mode-input .app-date-range-filter__mode {
  flex: 0 0 auto;
  align-self: center;
}

.app-date-range-filter__field-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.15rem;
}

.app-date-range-filter__field-seg {
  flex: 1 1 auto;
  min-height: 1.65rem;
  padding: 0.12rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 90%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--app-text) 2%, var(--app-surface));
  color: color-mix(in srgb, var(--app-text) 72%, var(--app-muted));
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.app-date-range-filter__field-seg:hover:not(.app-date-range-filter__field-seg--active) {
  border-color: color-mix(in srgb, var(--app-accent) 28%, var(--app-border));
  color: var(--app-text);
}

.app-date-range-filter__field-seg--active {
  border-color: color-mix(in srgb, var(--app-accent) 42%, var(--app-border));
  background: color-mix(in srgb, var(--app-accent) 11%, var(--app-surface));
  color: color-mix(in srgb, var(--app-accent) 88%, var(--app-text));
}
</style>
