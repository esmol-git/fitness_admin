<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppFilterBar from '@/components/ui/AppFilterBar.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import ServiceStaffFormFields from '@/components/service-staff/ServiceStaffFormFields.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import { DEFAULT_TABLE_PAGE_LIMIT } from '@/config/tablePagination'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useManagerScope } from '@/composables/useManagerScope'
import { useUiStore } from '@/stores/ui'
import type { ServiceStaffForm, ServiceStaffRow, ServiceStaffStatus } from '@/types/serviceStaff'
import { api } from '@/utils/api'

const { t, locale } = useI18n()
const { init: notify } = useToast()
const { isManagerReadOnly } = useManagerScope()
const ui = useUiStore()

const loading = ref(false)
const items = ref<ServiceStaffRow[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(DEFAULT_TABLE_PAGE_LIMIT)
const search = ref('')
const statusFilter = ref<'' | ServiceStaffStatus>('')
const inGymFilter = ref<'' | 'IN_GYM' | 'OUT_GYM'>('')

const formOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const formTab = ref<'general' | 'visits'>('general')
const formSaving = ref(false)
const cardNumberTaken = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<ServiceStaffRow | null>(null)
const deleteLoading = ref(false)

const emptyForm = (): ServiceStaffForm => ({
  firstName: '',
  lastName: '',
  middleName: '',
  position: '',
  phone: '',
  cardNumber: '',
  accessKey: '',
  status: 'ACTIVE',
  notes: '',
})

const form = ref<ServiceStaffForm>(emptyForm())

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

const statusFilterOptions = computed(() => [
  { value: '', text: t('common.all') },
  { value: 'ACTIVE', text: t('serviceStaff.statusActive') },
  { value: 'INACTIVE', text: t('serviceStaff.statusInactive') },
])

const inGymFilterOptions = computed(() => [
  { value: '', text: t('common.all') },
  { value: 'IN_GYM', text: t('clients.inGymYes') },
  { value: 'OUT_GYM', text: t('clients.inGymNo') },
])

const columns = computed(() => [
  { key: 'fullName', label: t('clients.fullName') },
  { key: 'visitEnteredAt', label: t('serviceStaff.visitEntered') },
  { key: 'visitExitedAt', label: t('serviceStaff.visitExited') },
  { key: 'status', label: t('clients.statusLabel') },
  {
    key: 'actions',
    label: t('clients.actions'),
    width: '5.5rem',
    thAlign: 'right' as const,
    tdAlign: 'right' as const,
  },
])

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(locale.value === 'en' ? 'en-US' : 'ru-RU')
}

const formModalTitle = computed(() =>
  formMode.value === 'create' ? t('serviceStaff.createTitle') : t('serviceStaff.editTitle'),
)

const formModalHint = computed(() =>
  formMode.value === 'create' ? t('serviceStaff.formHintCreate') : t('serviceStaff.formHintEdit'),
)

const formModalSummary = computed(() => {
  if (formMode.value === 'create') return ''
  const name = [form.value.lastName, form.value.firstName, form.value.middleName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const card = form.value.cardNumber.trim() || '—'
  return name ? t('serviceStaff.formEditSummary', { name, card }) : ''
})

async function loadList() {
  loading.value = true
  try {
    const { data } = await api.get<{ items: ServiceStaffRow[]; meta: { total: number } }>('/service-staff', {
      params: {
        page: page.value,
        limit: limit.value,
        search: search.value.trim() || undefined,
        status: statusFilter.value || undefined,
        inGym: inGymFilter.value || undefined,
        sortBy: 'fullName',
        sortOrder: 'asc',
      },
    })
    items.value = data.items ?? []
    total.value = data.meta?.total ?? 0
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, { defaultMessage: t('serviceStaff.loadFailed') }),
    })
  } finally {
    loading.value = false
  }
}

watch([page, limit, statusFilter, inGymFilter], () => void loadList())
watch(search, () => {
  page.value = 1
  void loadList()
})

void loadList()

watch(
  () => ui.serviceStaffTableRefreshTick,
  () => {
    void loadList()
  },
)

function statusLabel(status: ServiceStaffStatus) {
  return status === 'ACTIVE' ? t('serviceStaff.statusActive') : t('serviceStaff.statusInactive')
}

function statusTone(status: ServiceStaffStatus): 'success' | 'neutral' {
  return status === 'ACTIVE' ? 'success' : 'neutral'
}

function openCreate() {
  formMode.value = 'create'
  editingId.value = null
  form.value = emptyForm()
  formTab.value = 'general'
  cardNumberTaken.value = false
  formOpen.value = true
}

function openEdit(row: ServiceStaffRow) {
  formMode.value = 'edit'
  editingId.value = row.id
  form.value = {
    firstName: row.firstName,
    lastName: row.lastName,
    middleName: row.middleName ?? '',
    position: row.position ?? '',
    phone: row.phone ?? '',
    cardNumber: row.cardNumber,
    accessKey: row.accessKey ?? '',
    status: row.status,
    notes: row.notes ?? '',
  }
  formTab.value = 'general'
  cardNumberTaken.value = false
  formOpen.value = true
}

async function validateCard() {
  const card = form.value.cardNumber.trim()
  if (!card) {
    cardNumberTaken.value = false
    return
  }
  try {
    const { data } = await api.get<{ available: boolean }>('/service-staff/validate-card', {
      params: { cardNumber: card, excludeId: editingId.value ?? undefined },
    })
    cardNumberTaken.value = !data.available
  } catch {
    cardNumberTaken.value = false
  }
}

async function saveForm() {
  if (!form.value.firstName.trim() || !form.value.lastName.trim() || !form.value.cardNumber.trim()) {
    notify({ color: 'warning', message: t('serviceStaff.validationRequired') })
    return
  }
  if (cardNumberTaken.value) return
  formSaving.value = true
  try {
    const payload = {
      firstName: form.value.firstName.trim(),
      lastName: form.value.lastName.trim(),
      middleName: form.value.middleName.trim() || undefined,
      position: form.value.position.trim() || undefined,
      phone: form.value.phone.trim() || undefined,
      cardNumber: form.value.cardNumber.trim(),
      accessKey: form.value.accessKey.trim() || undefined,
      status: form.value.status,
      notes: form.value.notes.trim() || undefined,
    }
    if (formMode.value === 'create') {
      await api.post('/service-staff', payload)
      notify({ color: 'success', message: t('serviceStaff.created') })
    } else if (editingId.value) {
      await api.patch(`/service-staff/${editingId.value}`, payload)
      notify({ color: 'success', message: t('serviceStaff.updated') })
    }
    formOpen.value = false
    await loadList()
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, {
        defaultMessage: t('serviceStaff.saveFailed'),
        byCode: { CARD_NUMBER_EXISTS: t('clients.cardNumberTaken') },
      }),
    })
  } finally {
    formSaving.value = false
  }
}

function askDelete(row: ServiceStaffRow) {
  deleteTarget.value = row
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleteLoading.value = true
  try {
    await api.delete(`/service-staff/${deleteTarget.value.id}`)
    notify({ color: 'success', message: t('serviceStaff.deleted') })
    deleteOpen.value = false
    deleteTarget.value = null
    await loadList()
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, { defaultMessage: t('serviceStaff.deleteFailed') }),
    })
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <AppPageCard :title="t('serviceStaff.title')">
    <template #actions>
      <VaButton v-if="!isManagerReadOnly" color="primary" icon="add" @click="openCreate">
        {{ t('serviceStaff.add') }}
      </VaButton>
    </template>

    <AppFilterBar>
      <VaInput
        v-model="search"
        :label="t('clients.searchLabel')"
        :placeholder="t('serviceStaff.searchPlaceholder')"
        clearable
      />
      <VaSelect
        v-model="statusFilter"
        :label="t('clients.statusLabel')"
        :options="statusFilterOptions"
        value-by="value"
        text-by="text"
      />
      <VaSelect
        v-model="inGymFilter"
        :label="t('clients.filterInGym')"
        :options="inGymFilterOptions"
        value-by="value"
        text-by="text"
      />
    </AppFilterBar>

    <AppDataTableShell :loading="loading" :has-items="items.length > 0">
      <template #empty>
        <AppEmptyState icon="engineering" :title="t('serviceStaff.emptyTitle')" :description="t('serviceStaff.emptyDesc')" />
      </template>
      <VaDataTable v-if="items.length" class="service-staff-data-table app-table-actions-last-col" :items="items" :columns="columns">
        <template #cell(fullName)="{ rowData }">
          <button type="button" class="service-staff-name-link" @click="openEdit(rowData)">
            {{ rowData.fullName }}
          </button>
        </template>
        <template #cell(visitEnteredAt)="{ rowData }">
          {{ formatDateTime(rowData.visitEnteredAt) }}
        </template>
        <template #cell(visitExitedAt)="{ rowData }">
          {{ formatDateTime(rowData.visitExitedAt) }}
        </template>
        <template #cell(status)="{ rowData }">
          <StatusBadge :label="statusLabel(rowData.status)" :tone="statusTone(rowData.status)" />
        </template>
        <template #cell(actions)="{ rowData }">
          <div class="app-actions-cell" @click.stop>
            <VaButton
              size="large"
              preset="plain"
              :icon="TableActionIcon.edit"
              :aria-label="t('users.edit')"
              @click="openEdit(rowData)"
            />
            <VaButton
              v-if="!isManagerReadOnly"
              size="large"
              preset="plain"
              color="danger"
              :icon="TableActionIcon.delete"
              :aria-label="t('users.delete')"
              @click="askDelete(rowData)"
            />
          </div>
        </template>
      </VaDataTable>
      <template #pager>
        <AppTablePagerRow v-model:page="page" v-model:limit="limit" :pages="pages" :disabled="loading" />
      </template>
    </AppDataTableShell>

    <VaModal
      v-model="formOpen"
      hide-default-actions
      no-padding
      max-width="min(92vw, 680px)"
      class="user-editor-modal-shell"
    >
      <template #header />
      <form class="user-editor" @submit.prevent="saveForm">
        <header class="user-editor__header">
          <div class="user-editor__lead">
            <div class="user-editor__icon" aria-hidden="true">
              <VaIcon :name="formMode === 'create' ? 'person_add' : 'engineering'" size="22px" />
            </div>
            <div class="user-editor__head-copy">
              <h3 class="user-editor__title">{{ formModalTitle }}</h3>
              <p class="user-editor__summary">
                <template v-if="formModalSummary">{{ formModalSummary }}</template>
                <template v-else>{{ formModalHint }}</template>
              </p>
            </div>
          </div>
          <button
            type="button"
            class="user-editor__close"
            :disabled="formSaving"
            :aria-label="t('common.cancel')"
            @click="formOpen = false"
          >
            <VaIcon name="close" size="22px" />
          </button>
        </header>

        <div class="user-editor__body">
          <ServiceStaffFormFields
            v-model:form="form"
            v-model:active-tab="formTab"
            :is-create-mode="formMode === 'create'"
            :staff-id="editingId"
            :card-number-taken="cardNumberTaken"
            @validate-card="validateCard"
          />
        </div>

        <footer class="user-editor__footer">
          <VaButton
            type="button"
            preset="secondary"
            icon="close"
            :disabled="formSaving"
            @click="formOpen = false"
          >
            {{ t('common.cancel') }}
          </VaButton>
          <VaButton
            type="submit"
            :loading="formSaving"
            :disabled="isManagerReadOnly"
            :icon="formMode === 'create' ? 'check' : 'save'"
          >
            {{ t('users.save') }}
          </VaButton>
        </footer>
      </form>
    </VaModal>

    <ConfirmModal
      v-model="deleteOpen"
      :title="t('serviceStaff.deleteTitle')"
      :message="t('serviceStaff.deleteMessage', { name: deleteTarget?.fullName ?? '' })"
      :confirm-label="t('users.delete')"
      :cancel-label="t('users.cancel')"
      :loading="deleteLoading"
      danger
      @confirm="confirmDelete"
    />
  </AppPageCard>
</template>

<style scoped>
.service-staff-name-link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--va-primary);
  cursor: pointer;
  text-align: left;
}
.service-staff-name-link:hover {
  text-decoration: underline;
}

.service-staff-data-table.app-table-actions-last-col :deep(.va-data-table__table-th:last-child),
.service-staff-data-table.app-table-actions-last-col :deep(.va-data-table__table-td:last-child),
.service-staff-data-table.app-table-actions-last-col :deep(thead th:last-child),
.service-staff-data-table.app-table-actions-last-col :deep(tbody td:last-child) {
  text-align: right;
}

.service-staff-data-table.app-table-actions-last-col :deep(.va-data-table__table-th:last-child .va-data-table__table-th-content) {
  justify-content: flex-end;
}

.user-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.user-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0.8rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-accent) 5%, var(--app-surface)) 0%,
    var(--app-surface) 100%
  );
}

.user-editor__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  min-width: 0;
}

.user-editor__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent);
  flex-shrink: 0;
}

.user-editor__head-copy {
  min-width: 0;
}

.user-editor__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.3;
}

.user-editor__summary {
  margin: 0.22rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--app-muted);
}

.user-editor__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.user-editor__close:hover:not(:disabled) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-border) 14%);
}

.user-editor__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.user-editor__body {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  max-height: min(68dvh, 42rem);
  overflow: auto;
}

.user-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-bg-end));
}

.user-editor__footer :deep(.va-button) {
  min-height: var(--app-action-height);
  min-width: 8.5rem;
}

@media (max-width: 860px) {
  .user-editor__footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .user-editor__footer :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}
</style>
