<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toRuDateText } from '@/utils/ruDateInput'
import { api } from '@/utils/api'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'

export type ContractResumePreview = {
  contractNumber: string
  resumeDate: string
  hasActiveFreeze: boolean
  freezeStartDate: string | null
  freezeEndPlannedDate: string | null
  freezeEndActualDate: string | null
  plannedFreezeDays: number
  actualFreezeDays: number
  daysReverted: number
  serviceEndDateBefore: string | null
  serviceEndDateAfter: string | null
  statusAfter: string
}

const props = defineProps<{
  modelValue: boolean
  contractId: string | null
  loading?: boolean
  submitError?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit'): void
}>()

const { t, locale } = useI18n()

const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const preview = ref<ContractResumePreview | null>(null)

function formatDisplayDate(value?: string | null) {
  if (!value) return '—'
  const iso = value.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return value
  if (locale.value === 'en') return iso
  return toRuDateText(iso) || iso
}

const statusAfterLabel = computed(() => {
  const key = preview.value?.statusAfter
  if (!key) return '—'
  const path = `contracts.contractStatuses.${key}` as const
  const translated = t(path)
  return translated === path ? key : translated
})

const showRevert = computed(
  () => (preview.value?.daysReverted ?? 0) > 0 && Boolean(preview.value?.hasActiveFreeze),
)

async function loadPreview(contractId: string) {
  previewLoading.value = true
  previewError.value = null
  preview.value = null
  try {
    const { data } = await api.get<ContractResumePreview>(`/contracts/${contractId}/resume/preview`)
    preview.value = data
  } catch (e: unknown) {
    previewError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.resumePreviewFailed'),
      byCode: {
        ONLY_PAUSED_CAN_RESUME: t('contracts.onlyPausedCanResume'),
      },
    })
  } finally {
    previewLoading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function submit() {
  if (previewLoading.value || previewError.value || !preview.value) return
  emit('submit')
}

watch(
  () => [props.modelValue, props.contractId] as const,
  ([open, contractId]) => {
    if (open && contractId) {
      void loadPreview(contractId)
    } else if (!open) {
      preview.value = null
      previewError.value = null
    }
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
        <div class="freeze-icon freeze-icon--resume" aria-hidden="true">
          <VaIcon name="play_circle" size="22px" />
        </div>
        <div class="freeze-heading">
          <h3 class="freeze-title">{{ t('contracts.resumeTitle') }}</h3>
          <p v-if="preview?.contractNumber" class="freeze-subtitle">
            {{ t('contracts.freezeContractLabel', { number: preview.contractNumber }) }}
          </p>
          <p class="freeze-period">{{ t('contracts.resumeIntro') }}</p>
        </div>
      </header>

      <section class="freeze-body">
        <VaInnerLoading :loading="previewLoading">
          <div v-if="previewError" class="freeze-error" role="alert">
            <div class="freeze-error__icon" aria-hidden="true">
              <VaIcon name="error_outline" size="20px" />
            </div>
            <p class="freeze-error__text">{{ previewError }}</p>
          </div>

          <template v-else-if="preview">
            <dl class="resume-facts">
              <div v-if="preview.hasActiveFreeze" class="resume-facts__row">
                <dt>{{ t('contracts.resumeFreezePeriod') }}</dt>
                <dd>
                  {{ formatDisplayDate(preview.freezeStartDate) }}
                  —
                  {{ formatDisplayDate(preview.freezeEndPlannedDate) }}
                </dd>
              </div>
              <div v-if="preview.hasActiveFreeze" class="resume-facts__row">
                <dt>{{ t('contracts.resumeFreezePlannedDays') }}</dt>
                <dd>{{ t('contracts.resumeDays', { days: preview.plannedFreezeDays }) }}</dd>
              </div>
              <div class="resume-facts__row">
                <dt>{{ t('contracts.resumeDateLabel') }}</dt>
                <dd>{{ formatDisplayDate(preview.resumeDate) }}</dd>
              </div>
            </dl>

            <div class="freeze-summary freeze-summary--ready">
              <div class="freeze-summary__icon" aria-hidden="true">
                <VaIcon name="event_available" size="20px" />
              </div>
              <div class="freeze-summary__content">
                <template v-if="preview.hasActiveFreeze">
                  <p class="freeze-summary__message">
                    {{ t('contracts.resumeActualDays', { days: preview.actualFreezeDays }) }}
                  </p>
                  <p v-if="preview.actualFreezeDays === 0" class="freeze-summary__detail">
                    {{ t('contracts.resumeSameDayNote') }}
                  </p>
                  <p v-if="showRevert" class="freeze-summary__detail">
                    {{ t('contracts.resumeDaysReverted', { days: preview.daysReverted }) }}
                  </p>
                </template>
                <p v-else class="freeze-summary__message">
                  {{ t('contracts.resumeNoFreezeRecord') }}
                </p>
                <p
                  v-if="preview.serviceEndDateBefore && preview.serviceEndDateAfter"
                  class="freeze-summary__detail"
                >
                  {{ t('contracts.resumeEndDateChange') }}
                  <strong>{{ formatDisplayDate(preview.serviceEndDateBefore) }}</strong>
                  →
                  <strong>{{ formatDisplayDate(preview.serviceEndDateAfter) }}</strong>
                </p>
                <p class="freeze-summary__detail">
                  {{ t('contracts.resumeStatusAfter') }}
                  <strong>{{ statusAfterLabel }}</strong>
                </p>
              </div>
            </div>
          </template>
        </VaInnerLoading>

        <div v-if="props.submitError" class="freeze-error" role="alert">
          <div class="freeze-error__icon" aria-hidden="true">
            <VaIcon name="error_outline" size="20px" />
          </div>
          <p class="freeze-error__text">{{ props.submitError }}</p>
        </div>
      </section>

      <footer class="freeze-actions">
        <VaButton preset="secondary" :disabled="props.loading" @click="close">
          {{ t('common.cancel') }}
        </VaButton>
        <VaButton
          color="primary"
          icon="play_circle"
          :loading="props.loading"
          :disabled="previewLoading || Boolean(previewError) || !preview"
          @click="submit"
        >
          {{ t('contracts.resumeConfirm') }}
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
  flex-shrink: 0;
}

.freeze-icon--resume {
  background: color-mix(in srgb, var(--va-success) 14%, white);
  color: var(--va-success);
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

.freeze-summary {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-accent) 5%, var(--app-surface));
  padding: 0.85rem 1rem;
}

.freeze-summary--ready {
  border-color: color-mix(in srgb, var(--va-success) 34%, var(--app-border));
  background: color-mix(in srgb, var(--va-success) 10%, var(--app-surface));
}

.freeze-summary__icon {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--va-success) 12%, white);
  color: var(--va-success);
  flex-shrink: 0;
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

.resume-facts {
  margin: 0 0 0.85rem;
  display: grid;
  gap: 0.45rem;
}

.resume-facts__row {
  display: grid;
  gap: 0.15rem;
}

.resume-facts__row dt {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.resume-facts__row dd {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.4;
  color: var(--app-text);
}
</style>
