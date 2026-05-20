<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatIsoDate, pickerValueToIsoYmd, toDateValue } from '@/utils/ruDateInput'

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

function parseIso(value: string) {
  return toDateValue(value.trim()) ?? null
}

function diffDaysInclusive(startDate: Date, endDate: Date) {
  const start = startOfDay(startDate).getTime()
  const end = startOfDay(endDate).getTime()
  return Math.floor((end - start) / 86400000) + 1
}

function addDays(iso: string, days: number) {
  const base = parseIso(iso)
  if (!base) return ''
  const next = new Date(base)
  next.setDate(next.getDate() + days - 1)
  return formatIsoDate(next)
}

function formatDisplayDate(value?: string | null) {
  const parsed = value ? parseIso(String(value).slice(0, 10)) : null
  if (!parsed) return ''
  return parsed.toLocaleDateString(locale.value === 'en' ? 'en-US' : 'ru-RU')
}

const todayIso = computed(() => formatIsoDate(startOfDay(new Date())))

const contractStartIso = computed(() => {
  const raw = props.serviceStartDate
  if (!raw) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return formatIsoDate(raw)
  return String(raw).slice(0, 10)
})

const contractEndIso = computed(() => {
  const raw = props.serviceEndDate
  if (!raw) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return formatIsoDate(raw)
  return String(raw).slice(0, 10)
})

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
  const sd = parseIso(s)
  const ed = parseIso(e)
  if (!sd || !ed || ed < sd) return null
  return diffDaysInclusive(sd, ed)
})

const datesInvalid = computed(() => {
  const s = form.startDate.trim()
  const e = form.endDate.trim()
  if (!s || !e) return false
  const sd = parseIso(s)
  const ed = parseIso(e)
  if (!sd || !ed) return true
  return ed < sd
})

const outOfContractRange = computed(() => {
  const s = form.startDate.trim()
  const e = form.endDate.trim()
  if (!s || !e || datesInvalid.value) return false
  const sd = parseIso(s)
  const ed = parseIso(e)
  if (!sd || !ed) return false
  const cStart = contractStartIso.value ? parseIso(contractStartIso.value) : null
  const cEnd = contractEndIso.value ? parseIso(contractEndIso.value) : null
  if (cStart && sd < cStart) return true
  if (cEnd && ed > cEnd) return true
  return false
})

const canSubmit = computed(() => {
  if (datesInvalid.value || outOfContractRange.value) return false
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
  if (form.endDate.trim()) {
    const sd = parseIso(form.startDate)
    const ed = parseIso(form.endDate)
    if (sd && ed && ed < sd) form.endDate = ''
  }
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
          <VaIcon name="pause_circle" size="22px" />
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
            'freeze-summary--invalid': datesInvalid || outOfContractRange,
            'freeze-summary--ready': freezeDaysCount != null && !datesInvalid && !outOfContractRange,
          }"
        >
          <div class="freeze-summary__icon" aria-hidden="true">
            <VaIcon name="event" size="20px" />
          </div>
          <div class="freeze-summary__content">
            <template v-if="datesInvalid">
              <span class="freeze-summary__hint">{{ t('contracts.freezeManualDaysInvalid') }}</span>
            </template>
            <template v-else-if="outOfContractRange">
              <span class="freeze-summary__hint">{{ t('contracts.freezeOutOfRange') }}</span>
            </template>
            <template v-else-if="freezeDaysCount != null">
              <span class="freeze-summary__message">
                {{ t('contracts.freezeManualDaysSummary', { days: freezeDaysCount }) }}
              </span>
            </template>
            <template v-else>
              <span class="freeze-summary__hint">{{ t('contracts.freezePickDatesHint') }}</span>
            </template>
          </div>
        </div>

        <VaTextarea
          v-model="form.reason"
          :label="t('contracts.freezeReason')"
          :min-rows="2"
          :max-rows="4"
          autosize
          class="freeze-reason"
        />

        <VaAlert v-if="props.error" color="danger" outline>{{ props.error }}</VaAlert>
      </section>

      <footer class="freeze-actions">
        <VaButton preset="secondary" :disabled="props.loading" @click="close">
          {{ t('common.cancel') }}
        </VaButton>
        <VaButton
          color="primary"
          icon="pause"
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
  align-items: center;
  gap: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-accent) 5%, var(--app-surface));
  padding: 0.85rem 1rem;
  min-height: 4.5rem;
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
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.freeze-summary__message {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--app-text);
}

.freeze-summary__hint {
  font-size: 0.92rem;
  line-height: 1.35;
  color: var(--app-text-muted, color-mix(in srgb, var(--app-text) 70%, transparent));
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
