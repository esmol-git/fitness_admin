<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { copyTextToClipboard } from '@/utils/clipboard'
import AppDateRangeFilter from '@/components/ui/AppDateRangeFilter.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGER_MIN_TOTAL_ITEMS } from '@/config/tablePagination'
import type { ServiceStaffForm, StaffVisitRow } from '@/types/serviceStaff'
import { api } from '@/utils/api'

const props = defineProps<{
  form: ServiceStaffForm
  isCreateMode: boolean
  activeTab: 'general' | 'visits'
  staffId?: string | null
  cardNumberTaken?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:form', value: ServiceStaffForm): void
  (e: 'update:activeTab', value: 'general' | 'visits'): void
  (e: 'validate-card'): void
}>()

const { t, locale } = useI18n()
const { init: notify } = useToast()

const cardScannerOpen = ref(false)
const cardScannerDraft = ref('')
const cardScannerModalBodyRef = ref<HTMLElement | null>(null)

function openCardScannerModal() {
  cardScannerDraft.value = props.form.cardNumber
  cardScannerOpen.value = true
}

function focusCardScannerInput() {
  const root = cardScannerModalBodyRef.value
  if (!root) return
  const input = root.querySelector('input') as HTMLInputElement | null
  input?.focus()
  input?.select()
}

watch(cardScannerOpen, async (open) => {
  if (!open) return
  await nextTick()
  focusCardScannerInput()
})

function confirmCardScanner() {
  patchForm({ cardNumber: cardScannerDraft.value.trim() })
  cardScannerOpen.value = false
  emit('validate-card')
}

function cancelCardScanner() {
  cardScannerOpen.value = false
}

async function copyCardNumber() {
  const value = props.form.cardNumber.trim()
  if (!value) return
  const copied = await copyTextToClipboard(value)
  if (copied) {
    notify({ color: 'success', message: t('common.copied'), duration: 2200 })
  } else {
    notify({ color: 'danger', message: t('common.copyFailed'), duration: 3200 })
  }
}

const formTabs = computed(() => [
  { value: 'general' as const, text: t('serviceStaff.tabGeneral'), icon: 'badge' },
  { value: 'visits' as const, text: t('serviceStaff.tabVisits'), icon: 'history' },
])

const statusOptions = computed(() => [
  { value: 'ACTIVE', text: t('serviceStaff.statusActive') },
  { value: 'INACTIVE', text: t('serviceStaff.statusInactive') },
])

const visitsLoading = ref(false)
const visitsItems = ref<StaffVisitRow[]>([])
const visitsTotal = ref(0)
const visitsPage = ref(1)
const visitsLimit = ref(DEFAULT_TABLE_PAGE_LIMIT)
const visitsFrom = ref('')
const visitsTo = ref('')

const visitsPages = computed(() => Math.max(1, Math.ceil(visitsTotal.value / visitsLimit.value)))

const visitsColumns = computed(() => [
  { key: 'enteredAt', label: t('serviceStaff.visitEntered') },
  { key: 'exitedAt', label: t('serviceStaff.visitExited') },
  { key: 'status', label: t('clients.statusLabel') },
  { key: 'closeReason', label: t('visits.closeReasonLabel') },
])

function patchForm(patch: Partial<ServiceStaffForm>) {
  emit('update:form', { ...props.form, ...patch })
}

function setActiveTab(tab: 'general' | 'visits') {
  emit('update:activeTab', tab)
}

function visitStateLabel(state: string) {
  if (state === 'IN_GYM') return t('visits.stateInGym')
  if (state === 'OVERDUE') return t('visits.stateOverdue')
  if (state === 'FORCE_CLOSED') return t('visits.stateForceClosed')
  return t('visits.stateLeft')
}

function visitStateTone(state: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (state === 'IN_GYM') return 'success'
  if (state === 'OVERDUE') return 'warning'
  if (state === 'FORCE_CLOSED') return 'danger'
  return 'info'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(locale.value === 'en' ? 'en-US' : 'ru-RU')
}

async function loadVisits() {
  if (!props.staffId) return
  visitsLoading.value = true
  try {
    const { data } = await api.get<{ items: StaffVisitRow[]; meta: { total: number } }>(
      '/service-staff-visits',
      {
        params: {
          staffId: props.staffId,
          page: visitsPage.value,
          limit: visitsLimit.value,
          from: visitsFrom.value || undefined,
          to: visitsTo.value || undefined,
          sortBy: 'enteredAt',
          sortOrder: 'desc',
        },
      },
    )
    visitsItems.value = data.items ?? []
    visitsTotal.value = data.meta?.total ?? 0
  } finally {
    visitsLoading.value = false
  }
}

watch(
  () => props.activeTab,
  (tab) => {
    if (tab === 'visits' && props.staffId) void loadVisits()
  },
)

watch([visitsPage, visitsLimit, visitsFrom, visitsTo], () => {
  if (props.activeTab === 'visits' && props.staffId) void loadVisits()
})

function resetVisitsFilters() {
  visitsFrom.value = ''
  visitsTo.value = ''
  visitsPage.value = 1
}
</script>

<template>
  <div class="service-staff-form" :class="{ 'service-staff-form--tabbed': !isCreateMode }">
    <div
      v-if="!isCreateMode"
      class="service-staff-form-tabs"
      role="tablist"
      :aria-label="t('serviceStaff.tabListAria')"
    >
      <button
        v-for="tab in formTabs"
        :key="tab.value"
        type="button"
        role="tab"
        class="service-staff-form-tab"
        :class="{ 'service-staff-form-tab--active': activeTab === tab.value }"
        :aria-selected="activeTab === tab.value ? 'true' : 'false'"
        @click="setActiveTab(tab.value)"
      >
        <VaIcon :name="tab.icon" size="17px" class="service-staff-form-tab__icon" aria-hidden="true" />
        <span class="service-staff-form-tab__label">{{ tab.text }}</span>
      </button>
    </div>

    <div class="service-staff-form-body">
      <div v-if="activeTab === 'general'" class="service-staff-form-general">
        <section class="user-form-card">
          <header class="user-form-card__head">
            <span class="user-form-card__label">{{ t('serviceStaff.sections.personal') }}</span>
          </header>
          <div class="user-form-card__grid user-form-card__grid--2">
            <VaInput
              :model-value="form.lastName"
              :label="t('clients.lastName')"
              @update:model-value="patchForm({ lastName: String($event ?? '') })"
            />
            <VaInput
              :model-value="form.firstName"
              :label="t('clients.firstName')"
              @update:model-value="patchForm({ firstName: String($event ?? '') })"
            />
          </div>
          <div class="user-form-card__grid user-form-card__grid--2">
            <VaInput
              :model-value="form.middleName"
              :label="t('clients.middleName')"
              @update:model-value="patchForm({ middleName: String($event ?? '') })"
            />
            <VaInput
              :model-value="form.position"
              :label="t('serviceStaff.position')"
              :placeholder="t('serviceStaff.positionPlaceholder')"
              @update:model-value="patchForm({ position: String($event ?? '') })"
            />
          </div>
          <div class="user-form-card__grid user-form-card__grid--2">
            <VaInput
              :model-value="form.phone"
              :label="t('clients.phone')"
              :placeholder="t('clients.phonePlaceholder')"
              @update:model-value="patchForm({ phone: String($event ?? '') })"
            />
            <VaSelect
              :model-value="form.status"
              :label="t('clients.statusLabel')"
              :options="statusOptions"
              value-by="value"
              text-by="text"
              @update:model-value="patchForm({ status: $event as ServiceStaffForm['status'] })"
            />
          </div>
        </section>

        <section class="user-form-card">
          <header class="user-form-card__head">
            <span class="user-form-card__label">{{ t('serviceStaff.sections.access') }}</span>
          </header>
          <p class="user-form-card__hint">{{ t('serviceStaff.cardNumberHint') }}</p>
          <VaInput
            class="card-number-readonly"
            readonly
            :model-value="form.cardNumber"
            :title="t('clients.cardScannerFieldHint')"
            :error="cardNumberTaken"
            :error-messages="cardNumberTaken ? [t('clients.cardNumberTaken')] : []"
            @click="openCardScannerModal"
            @paste.prevent
          >
            <template #label>
              <span class="label-with-tip">
                <span>{{ t('clients.cardNumber') }}</span>
                <VaPopover :message="t('clients.cardNumberUniqueHint')">
                  <VaIcon name="info_outline" size="14px" color="secondary" />
                </VaPopover>
              </span>
            </template>
            <template #appendInner>
              <div class="card-field-append">
                <VaButton
                  type="button"
                  preset="plain"
                  icon="qr_code_scanner"
                  size="small"
                  class="field-copy-btn"
                  :title="t('clients.cardScannerButtonTitle')"
                  @click.stop="openCardScannerModal"
                />
                <VaButton
                  v-if="form.cardNumber.trim()"
                  type="button"
                  preset="plain"
                  icon="content_copy"
                  size="small"
                  class="field-copy-btn"
                  :title="t('common.copy')"
                  @click.stop="copyCardNumber"
                />
              </div>
            </template>
          </VaInput>
          <VaTextarea
            :model-value="form.notes"
            :label="t('clients.notes')"
            :min-rows="2"
            @update:model-value="patchForm({ notes: String($event ?? '') })"
          />
        </section>
      </div>

      <div v-else-if="activeTab === 'visits' && staffId" class="service-staff-visits-tab">
        <div class="service-staff-visits-filters">
          <div class="service-staff-visits-filters__row">
            <AppDateRangeFilter
              v-model:from="visitsFrom"
              v-model:to="visitsTo"
              :label="t('visits.filterDateRange')"
              :range-placeholder="t('visits.dateRangePlaceholder')"
              input-class="app-date-range-filter__input service-staff-visits-filters__range"
            />
          </div>
          <div class="service-staff-visits-filters__actions">
            <VaButton
              size="small"
              preset="secondary"
              icon="close"
              :disabled="!visitsFrom && !visitsTo"
              @click="resetVisitsFilters"
            >
              {{ t('contracts.resetFilters') }}
            </VaButton>
          </div>
        </div>
        <div v-if="visitsLoading" class="service-staff-visits-tab__loading" aria-busy="true">
          <VaIcon name="sync" class="service-staff-visits-tab__spinner" />
        </div>
        <template v-else>
          <AppEmptyState
            v-if="!visitsItems.length"
            icon="history"
            :title="t('serviceStaff.visitsEmptyTitle')"
            :description="t('serviceStaff.visitsEmptyDesc')"
          />
          <template v-else>
            <VaDataTable :items="visitsItems" :columns="visitsColumns" class="service-staff-visits-table">
              <template #cell(enteredAt)="{ rowData }">
                {{ formatDateTime(rowData.enteredAt) }}
              </template>
              <template #cell(exitedAt)="{ rowData }">
                {{ formatDateTime(rowData.exitedAt) }}
              </template>
              <template #cell(status)="{ rowData }">
                <StatusBadge :label="visitStateLabel(rowData.status)" :tone="visitStateTone(rowData.status)" />
              </template>
              <template #cell(closeReason)="{ rowData }">
                {{ rowData.closeReason ? t(`visits.closeReason.${rowData.closeReason}`) : '—' }}
              </template>
            </VaDataTable>
            <div v-if="visitsTotal > TABLE_PAGER_MIN_TOTAL_ITEMS" class="service-staff-visits-footer">
              <AppTablePagerRow
                v-model:page="visitsPage"
                v-model:limit="visitsLimit"
                :pages="visitsPages"
                :disabled="visitsLoading"
              />
            </div>
          </template>
        </template>
      </div>
    </div>

    <VaModal v-model="cardScannerOpen" hide-default-actions fixed-layout max-width="min(92vw, 440px)">
      <div ref="cardScannerModalBodyRef" class="card-scanner-modal">
        <h3 class="card-scanner-modal__title">{{ t('clients.cardScannerModalTitle') }}</h3>
        <p class="card-scanner-modal__hint">{{ t('clients.cardScannerModalHint') }}</p>
        <VaInput
          v-model="cardScannerDraft"
          :label="t('clients.cardNumber')"
          autocomplete="off"
          @keydown.enter.prevent="confirmCardScanner"
        />
        <div class="card-scanner-modal__actions">
          <VaButton type="button" preset="secondary" @click="cancelCardScanner">{{ t('common.cancel') }}</VaButton>
          <VaButton type="button" @click="confirmCardScanner">{{ t('users.save') }}</VaButton>
        </div>
      </div>
    </VaModal>
  </div>
</template>

<style scoped>
.label-with-tip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.card-field-append {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}

.card-number-readonly :deep(.va-input-wrapper__text),
.card-number-readonly :deep(input) {
  cursor: pointer;
}

.field-copy-btn {
  flex-shrink: 0;
}

.card-scanner-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.25rem 0.15rem 0.5rem;
  box-sizing: border-box;
}

.card-scanner-modal__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.3;
}

.card-scanner-modal__hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--app-muted, #6b7280);
}

.card-scanner-modal__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.service-staff-form {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.service-staff-form-general {
  display: grid;
  gap: 0.75rem;
}

.service-staff-form-tabs {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  flex-wrap: wrap;
  padding: 0.35rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  background: color-mix(in srgb, var(--app-text) 4%, var(--app-surface));
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--app-text) 5%, transparent);
}

.service-staff-form-tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.42rem;
  min-height: 2.4rem;
  min-width: 0;
  padding: 0.45rem 0.75rem;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 56%, var(--app-muted));
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.service-staff-form-tab:hover:not(.service-staff-form-tab--active) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-accent) 14%);
  border-color: color-mix(in srgb, var(--app-accent) 22%, transparent);
}

.service-staff-form-tab--active {
  color: #fff;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 90%, white 10%) 0%,
    color-mix(in srgb, var(--app-accent) 76%, black 24%) 100%
  );
  border-color: color-mix(in srgb, var(--app-accent) 62%, black 38%);
  box-shadow:
    0 2px 10px color-mix(in srgb, var(--app-accent) 34%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
}

.service-staff-form-tab__icon {
  flex-shrink: 0;
  opacity: 0.72;
}

.service-staff-form-tab--active .service-staff-form-tab__icon {
  opacity: 1;
}

.service-staff-form-tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.service-staff-form-body {
  min-width: 0;
}

.user-form-card {
  display: grid;
  gap: 0.7rem;
  padding: 0.8rem 0.85rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  background: color-mix(in srgb, var(--app-surface) 98%, white 2%);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-text) 4%, transparent);
}

.user-form-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.user-form-card__label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.user-form-card__hint {
  margin: -0.15rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--app-muted);
}

.user-form-card__grid {
  display: grid;
  gap: 0.75rem;
}

.user-form-card__grid--2 {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.user-form-card :deep(.va-input-wrapper),
.user-form-card :deep(.va-select),
.user-form-card :deep(.va-textarea) {
  min-width: 0;
  max-width: 100%;
}

.user-form-card :deep(.va-input-wrapper__container),
.user-form-card :deep(.va-input-wrapper__field),
.user-form-card :deep(.va-select__anchor) {
  min-height: 2.85rem;
}

.service-staff-visits-filters {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
  min-width: 0;
}

.service-staff-visits-filters__row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.65rem;
  align-items: flex-end;
  min-width: 0;
}

.service-staff-visits-filters__actions {
  display: flex;
  justify-content: flex-end;
}

.service-staff-visits-filters__row > :deep(.app-date-range-filter) {
  flex: 1 1 14rem;
  min-width: 12rem;
}

.service-staff-visits-filters__range {
  width: 100%;
}

.service-staff-visits-tab__loading {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.service-staff-visits-tab__spinner {
  animation: service-staff-spin 1s linear infinite;
}

.service-staff-visits-footer {
  margin-top: 0.65rem;
  padding: 0.55rem 0.7rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface));
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.service-staff-visits-table :deep(.va-data-table__table) {
  width: 100%;
}

@keyframes service-staff-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 520px) {
  .user-form-card__grid--2 {
    grid-template-columns: 1fr;
  }
}
</style>
