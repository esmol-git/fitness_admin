<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  addUtcCalendarDaysInclusiveEndIsoYmd,
  addUtcCalendarDaysIsoYmd,
  diffDaysInclusiveUtcYmd,
  formatIsoDate,
  isoYmdFromDateField,
  pickerValueToIsoYmd,
  toDateValue,
  toRuDateText,
} from '@/utils/ruDateInput'

const props = defineProps<{
  modelValue: boolean
  loading?: boolean
  error?: string | null
  contractNumber?: string | null
  serviceStartDate?: string | Date | null
  serviceEndDate?: string | Date | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', value: { startDate: string; endDate: string; reason: string }): void
}>()

const { t, locale } = useI18n()

const form = reactive({ startDate: '', endDate: '', reason: '' })

const quickDurations = [7, 14, 30] as const

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function toIsoDate(value: unknown) {
  return pickerValueToIsoYmd(value)
}

function isoToPickerDate(value: string) {
  return toDateValue(value.trim()) ?? undefined
}

function addDays(iso: string, days: number) {
  return addUtcCalendarDaysInclusiveEndIsoYmd(iso, days)
}

function formatDisplayDate(value?: string | null) {
  const iso = value?.trim().slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const ru = toRuDateText(iso)
  if (!ru) return iso
  return locale.value === 'en'
    ? iso
    : ru
}

const todayIso = computed(() => formatIsoDate(startOfDay(new Date())))

const contractStartIso = computed(() => isoYmdFromDateField(props.serviceStartDate))

const contractEndIso = computed(() => isoYmdFromDateField(props.serviceEndDate))

const defaultStartIso = computed(() => {
  const today = todayIso.value
  const start = contractStartIso.value
  if (!start) return today
  return start > today ? start : today
})

const periodHint = computed(() => {
  const from = formatDisplayDate(contractStartIso.value ?? defaultStartIso.value)
  const to = formatDisplayDate(contractEndIso.value)
  if (!from && !to) return ''
  if (from && to) return t('contracts.freezePeriodHint', { from, to })
  if (to) return t('contracts.freezePeriodHintUntil', { to })
  return t('contracts.freezePeriodHintFrom', { from })
})

const freezeDaysCount = computed(() => {
  const s = form.startDate.trim()
  const e = form.endDate.trim()
  if (!s || !e) return null
  return diffDaysInclusiveUtcYmd(s, e)
})

const datesInvalid = computed(() => {
  const s = form.startDate.trim()
  const e = form.endDate.trim()
  if (!s || !e) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return true
  return e < s
})

/** Начало заморозки — в периоде действия договора; окончание может быть позже текущей даты окончания (срок продлится). */
const freezeStartOutOfRange = computed(() => {
  const s = form.startDate.trim()
  if (!s || datesInvalid.value || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const cStart = contractStartIso.value
  const cEnd = contractEndIso.value
  if (cStart && s < cStart) return true
  if (cEnd && s > cEnd) return true
  return false
})

const extendedContractEndIso = computed(() => {
  const days = freezeDaysCount.value
  const endIso = contractEndIso.value
  if (!endIso || typeof days !== 'number' || days < 1) return null
  return addUtcCalendarDaysIsoYmd(endIso, days)
})

const canSubmit = computed(() => {
  if (datesInvalid.value || freezeStartOutOfRange.value) return false
  return typeof freezeDaysCount.value === 'number' && freezeDaysCount.value >= 1
})

function quickDurationLabel(days: number) {
  if (days === 7) return t('contracts.freezePreset7')
  if (days === 14) return t('contracts.freezePreset14')
  return t('contracts.freezePreset30')
}

function resetForm() {
  form.startDate = defaultStartIso.value
  form.endDate = ''
  form.reason = ''
}

function close() {
  emit('update:modelValue', false)
}

function applyQuickDuration(days: number) {
  if (!form.startDate.trim()) {
    form.startDate = defaultStartIso.value
  }
  form.endDate = addDays(form.startDate, days)
}

function onEndDateChange(value: unknown) {
  form.endDate = toIsoDate(value)
}

function onStartDateChange(value: unknown) {
  form.startDate = toIsoDate(value)
  if (form.endDate.trim() && form.endDate < form.startDate) form.endDate = ''
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    startDate: form.startDate.trim(),
    endDate: form.endDate.trim(),
    reason: form.reason.trim(),
  })
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm()
  },
)
</script>

<template>
  <VaModal
    :model-value="props.modelValue"
    max-width="min(92vw, 520px)"
    hide-default-actions
    no-padding
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="freeze-shell">
      <header class="freeze-header">
        <div class="freeze-icon" aria-hidden="true">
          <VaIcon name="ac_unit" size="22px" />
        </div>
        <div class="freeze-heading">
          <h3 class="freeze-title">{{ t('contracts.freezeTitle') }}</h3>
          <p v-if="props.contractNumber" class="freeze-subtitle">
            {{ t('contracts.freezeContractLabel', { number: props.contractNumber }) }}
          </p>
          <p v-if="periodHint" class="freeze-period">{{ periodHint }}</p>
        </div>
      </header>

      <section class="freeze-body">
        <div class="freeze-dates">
          <VaDateInput
            :model-value="isoToPickerDate(form.startDate)"
            :label="t('contracts.freezeStartDate')"
            class="freeze-dates__field"
            @update:model-value="onStartDateChange"
          />
          <VaDateInput
            :model-value="isoToPickerDate(form.endDate)"
            :label="t('contracts.freezeEndDate')"
            class="freeze-dates__field"
            @update:model-value="onEndDateChange"
          />
        </div>

        <div class="freeze-quick">
          <span class="freeze-quick__label">{{ t('contracts.freezeQuickPick') }}</span>
          <div class="freeze-quick__chips">
            <button
              v-for="days in quickDurations"
              :key="days"
              type="button"
              class="freeze-chip"
              @click="applyQuickDuration(days)"
            >
              {{ quickDurationLabel(days) }}
            </button>
          </div>
        </div>

        <div
          class="freeze-summary"
          :class="{
            'freeze-summary--invalid': datesInvalid || freezeStartOutOfRange,
            'freeze-summary--ready': freezeDaysCount != null && !datesInvalid && !freezeStartOutOfRange,
          }"
        >
          <div class="freeze-summary__icon" aria-hidden="true">
            <VaIcon name="event" size="20px" />
          </div>
          <div class="freeze-summary__content">
            <template v-if="datesInvalid">
              <span class="freeze-summary__hint">{{ t('contracts.freezeManualDaysInvalid') }}</span>
            </template>
            <template v-else-if="freezeStartOutOfRange">
              <span class="freeze-summary__hint">{{ t('contracts.freezeOutOfRange') }}</span>
            </template>
            <template v-else-if="freezeDaysCount != null">
              <p class="freeze-summary__message">
                {{ t('contracts.freezeManualDaysSummary', { days: freezeDaysCount }) }}
              </p>
              <p v-if="extendedContractEndIso" class="freeze-summary__detail">
                {{
                  t('contracts.freezeExtendPreview', {
                    date: formatDisplayDate(extendedContractEndIso),
                  })
                }}
              </p>
            </template>
            <template v-else>
              <span class="freeze-summary__hint">{{ t('contracts.freezePickDatesHint') }}</span>
            </template>
          </div>
        </div>

        <div v-if="props.error" class="freeze-error" role="alert">
          <div class="freeze-error__icon" aria-hidden="true">
            <VaIcon name="error_outline" size="20px" />
          </div>
          <p class="freeze-error__text">{{ props.error }}</p>
        </div>

        <VaTextarea
          v-model="form.reason"
          :label="t('contracts.freezeReason')"
          :min-rows="2"
          :max-rows="4"
          autosize
          class="freeze-reason"
        />
      </section>

      <footer class="freeze-actions">
        <VaButton preset="secondary" :disabled="props.loading" @click="close">
          {{ t('common.cancel') }}
        </VaButton>
        <VaButton
          color="primary"
          icon="ac_unit"
          :loading="props.loading"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t('contracts.pause') }}
        </VaButton>
      </footer>
    </div>
  </VaModal>
</template>

<style scoped>
.freeze-shell {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-height: min(88vh, 640px);
  padding: 1.25rem;
  gap: 1rem;
  overflow: auto;
}

.freeze-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.freeze-icon {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--app-accent) 14%, white);
  color: var(--app-accent-strong);
  flex-shrink: 0;
}

.freeze-heading {
  min-width: 0;
}

.freeze-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--app-text);
}

.freeze-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--app-text);
}

.freeze-period {
  margin: 0.25rem 0 0;
  font-size: 0.88rem;
  line-height: 1.35;
  color: var(--app-text-muted, color-mix(in srgb, var(--app-text) 68%, transparent));
}

.freeze-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.freeze-dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.freeze-quick {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.freeze-quick__label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-muted, color-mix(in srgb, var(--app-text) 62%, transparent));
}

.freeze-quick__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.freeze-chip {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--app-accent) 28%, var(--app-border));
  background: color-mix(in srgb, var(--app-accent) 8%, var(--app-surface));
  color: var(--app-accent-strong);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.freeze-chip:hover {
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  border-color: color-mix(in srgb, var(--app-accent) 42%, var(--app-border));
}

.freeze-chip:active {
  transform: scale(0.98);
}

.freeze-summary {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-accent) 5%, var(--app-surface));
  padding: 0.85rem 1rem;
  min-height: auto;
}

.freeze-summary--ready {
  border-color: color-mix(in srgb, var(--app-accent) 34%, var(--app-border));
  background: color-mix(in srgb, var(--app-accent) 10%, var(--app-surface));
}

.freeze-summary--invalid {
  border-color: color-mix(in srgb, var(--va-warning) 40%, var(--app-border));
  background: color-mix(in srgb, var(--va-warning) 8%, var(--app-surface));
}

.freeze-summary__icon {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--app-accent) 12%, white);
  color: var(--app-accent-strong);
  flex-shrink: 0;
}

.freeze-summary--invalid .freeze-summary__icon {
  background: color-mix(in srgb, var(--va-warning) 14%, white);
  color: var(--va-warning);
}

.freeze-summary__content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-width: 0;
  flex: 1;
}

.freeze-summary__message {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--app-text);
}

.freeze-summary__detail {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: var(--app-text-muted, color-mix(in srgb, var(--app-text) 70%, transparent));
}

.freeze-summary__hint {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: var(--app-text-muted, color-mix(in srgb, var(--app-text) 70%, transparent));
}

.freeze-error {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--va-danger) 38%, var(--app-border));
  background: color-mix(in srgb, var(--va-danger) 8%, var(--app-surface));
  padding: 0.75rem 0.9rem;
}

.freeze-error__icon {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--va-danger) 14%, white);
  color: var(--va-danger);
}

.freeze-error__text {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--va-danger) 82%, var(--app-text));
}

.freeze-reason :deep(textarea) {
  min-height: 4.5rem;
}

.freeze-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  flex-shrink: 0;
  margin: 0;
  padding-top: 1rem;
  border-top: 1px solid var(--app-border);
}

.freeze-actions :deep(.va-button) {
  min-width: 6.5rem;
}

@media (max-width: 640px) {
  .freeze-shell {
    padding: 1.1rem;
  }

  .freeze-dates {
    grid-template-columns: 1fr;
  }

  .freeze-actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .freeze-actions :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}
</style>
