<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { invalidateActiveMembershipCatalogCache } from '@/composables/membershipCatalogCache'
import { api } from '@/utils/api'
import type { TableHeaderConfig } from '@/types/table'

type MembershipItem = {
  id: string
  name: string
  price: number | null
  durationValue: number | null
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
  description: string | null
  isActive: boolean
}

const { t } = useI18n()
const { init: notify } = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const togglingId = ref<string | null>(null)
const error = ref<string | null>(null)
const items = ref<MembershipItem[]>([])
const open = ref(false)
const deleteOpen = ref(false)
const editingId = ref<string | null>(null)
const deletingItem = ref<MembershipItem | null>(null)
const form = ref({
  name: '',
  price: '',
  durationValue: '',
  durationUnit: 'MONTH' as 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL',
  description: '',
  isActive: true,
})

const canSubmit = computed(() => form.value.name.trim().length > 0)
const durationUnitOptions = computed(() => [
  { value: 'DAY', text: t('directories.memberships.units.DAY') },
  { value: 'WEEK', text: t('directories.memberships.units.WEEK') },
  { value: 'MONTH', text: t('directories.memberships.units.MONTH') },
  { value: 'TRIAL', text: t('directories.memberships.units.TRIAL') },
])
const presets = computed(() => [
  { label: t('directories.memberships.presets.trial'), value: 1, unit: 'TRIAL' as const },
  { label: t('directories.memberships.presets.week1'), value: 1, unit: 'WEEK' as const },
  { label: t('directories.memberships.presets.week2'), value: 2, unit: 'WEEK' as const },
  { label: t('directories.memberships.presets.month1'), value: 1, unit: 'MONTH' as const },
  { label: t('directories.memberships.presets.month3'), value: 3, unit: 'MONTH' as const },
  { label: t('directories.memberships.presets.month6'), value: 6, unit: 'MONTH' as const },
  { label: t('directories.memberships.presets.month12'), value: 12, unit: 'MONTH' as const },
])
const isTrialDuration = computed(() => form.value.durationUnit === 'TRIAL')

const hasDurationValue = computed(() => {
  if (isTrialDuration.value) return true
  const raw = form.value.durationValue.trim()
  if (!raw) return false
  const value = Number(raw)
  return Number.isFinite(value) && value > 0
})

/** VaCounter: пустое поле ↔ бессрочный шаблон; число > 0 ↔ срок в форме. Для TRIAL всегда 1, поле заблокировано. */
const durationCounterModel = computed<string | number>({
  get() {
    if (form.value.durationUnit === 'TRIAL') return 1
    const raw = form.value.durationValue.trim()
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n) || n <= 0) return ''
    return Math.min(999, Math.floor(n))
  },
  set(v) {
    if (form.value.durationUnit === 'TRIAL') {
      form.value.durationValue = '1'
      return
    }
    if (v === '' || v === null || v === undefined) {
      form.value.durationValue = ''
      return
    }
    const n = typeof v === 'number' ? v : Number(String(v).trim())
    if (!Number.isFinite(n) || n <= 0) form.value.durationValue = ''
    else form.value.durationValue = String(Math.min(999, Math.floor(n)))
  },
})

const durationSummary = computed(() => {
  const raw = form.value.durationValue.trim()
  const unit = form.value.durationUnit
  if (!hasDurationValue.value) return t('directories.memberships.noDuration')
  if (unit === 'TRIAL') return t('directories.memberships.durationPreviewTrial')
  const value = Number(raw)
  return t('directories.memberships.durationPreview', {
    value,
    unit: t(`directories.memberships.units.${unit}`),
  })
})

const tableBusy = computed(() => loading.value || saving.value || deleting.value || togglingId.value !== null)

const tableColumns = computed<TableHeaderConfig[]>(() => [
  { key: 'name', label: t('directories.memberships.fields.name') },
  { key: 'isActive', label: t('directories.memberships.fields.isActive') },
  { key: 'price', label: t('directories.memberships.fields.price') },
  { key: 'term', label: t('directories.memberships.fields.term') },
  {
    key: 'actions',
    label: t('clients.actions'),
    width: '10rem',
    thAlign: 'right',
    tdAlign: 'right',
  },
])

async function loadItems() {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get('/membership-catalog')
    items.value = (data as MembershipItem[]).sort((a, b) => a.name.localeCompare(b.name))
  } catch (e: unknown) {
    error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('directories.memberships.loadFailed'),
    })
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', price: '', durationValue: '', durationUnit: 'MONTH', description: '', isActive: true }
  open.value = true
}

function openEdit(item: MembershipItem) {
  if (tableBusy.value) return
  editingId.value = item.id
  const unit = item.durationUnit || 'MONTH'
  form.value = {
    name: item.name,
    price: item.price == null ? '' : String(item.price),
    durationValue:
      unit === 'TRIAL' ? '1' : item.durationValue == null ? '' : String(item.durationValue),
    durationUnit: unit,
    description: item.description ?? '',
    isActive: item.isActive !== false,
  }
  open.value = true
}

function onDurationUnitChange(v: unknown) {
  const u = (v as 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL') || 'MONTH'
  form.value.durationUnit = u
  if (u === 'TRIAL') {
    form.value.durationValue = '1'
  }
}

function askDelete(item: MembershipItem) {
  if (tableBusy.value) return
  deletingItem.value = item
  deleteOpen.value = true
}

type MembershipTableRowClickPayload = {
  event: Event
  item: Record<string, unknown>
  itemIndex: number
}

function handleTableRowClick(payload: MembershipTableRowClickPayload) {
  if (tableBusy.value) return
  const target = payload.event.target
  if (!(target instanceof Element)) return
  if (target.closest('.app-actions-cell')) return
  openEdit(payload.item as MembershipItem)
}

async function toggleActive(item: MembershipItem) {
  if (tableBusy.value) return
  const nextActive = item.isActive === false
  togglingId.value = item.id
  try {
    await api.patch(`/membership-catalog/${item.id}`, { isActive: nextActive })
    invalidateActiveMembershipCatalogCache()
    const row = items.value.find((entry) => entry.id === item.id)
    if (row) row.isActive = nextActive
    notify({
      color: 'success',
      message: nextActive
        ? t('directories.memberships.activated')
        : t('directories.memberships.deactivated'),
    })
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, {
        defaultMessage: t('directories.memberships.saveFailed'),
      }),
    })
  } finally {
    togglingId.value = null
  }
}

async function save() {
  if (!canSubmit.value) return
  saving.value = true
  error.value = null
  try {
    const normalizedDuration =
      form.value.durationValue.trim() === ''
        ? undefined
        : Number(form.value.durationValue.trim())
    const payload = {
      name: form.value.name.trim(),
      price:
        form.value.price.trim() === '' || Number.isNaN(Number(form.value.price.trim()))
          ? undefined
          : Number(form.value.price.trim()),
      durationValue:
        normalizedDuration !== undefined && Number.isFinite(normalizedDuration) && normalizedDuration > 0
          ? normalizedDuration
          : undefined,
      durationUnit:
        normalizedDuration !== undefined && Number.isFinite(normalizedDuration) && normalizedDuration > 0
          ? form.value.durationUnit
          : undefined,
      description: form.value.description.trim() || undefined,
      isActive: form.value.isActive,
    }
    if (editingId.value) {
      await api.patch(`/membership-catalog/${editingId.value}`, payload)
      notify({ color: 'success', message: t('directories.memberships.updated') })
    } else {
      await api.post('/membership-catalog', payload)
      notify({ color: 'success', message: t('directories.memberships.created') })
    }
    open.value = false
    invalidateActiveMembershipCatalogCache()
    await loadItems()
  } catch (e: unknown) {
    error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('directories.memberships.saveFailed'),
      byStatus: { 409: t('directories.memberships.duplicate') },
      byCode: {
        MEMBERSHIP_EXISTS: t('directories.memberships.duplicate'),
        MEMBERSHIP_NOT_FOUND: t('directories.memberships.saveFailed'),
      },
    })
  } finally {
    saving.value = false
  }
}

function applyPreset(value: number, unit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL') {
  form.value.durationValue = String(value)
  form.value.durationUnit = unit
}

function isPresetActive(preset: { value: number; unit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' }) {
  if (!hasDurationValue.value) return false
  return form.value.durationUnit === preset.unit && Number(form.value.durationValue) === preset.value
}

function formatTerm(item: MembershipItem) {
  if (!item.durationUnit || !item.durationValue) return '—'
  if (item.durationUnit === 'TRIAL') return t('directories.memberships.durationPreviewTrial')
  return `${item.durationValue} ${t(`directories.memberships.units.${item.durationUnit}`)}`
}

function formatPrice(item: MembershipItem) {
  if (item.price == null) return '—'
  return `${Number(item.price).toFixed(2)}`
}

async function remove() {
  if (!deletingItem.value) return
  deleting.value = true
  error.value = null
  try {
    await api.delete(`/membership-catalog/${deletingItem.value.id}`)
    deleteOpen.value = false
    notify({ color: 'success', message: t('directories.memberships.deleted') })
    invalidateActiveMembershipCatalogCache()
    await loadItems()
  } catch (e: unknown) {
    error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('directories.memberships.deleteFailed'),
      byCode: {
        MEMBERSHIP_NOT_FOUND: t('directories.memberships.deleteFailed'),
      },
    })
  } finally {
    deleting.value = false
  }
}

void loadItems()
</script>

<template>
  <AppPageCard :title="t('directories.memberships.title')">
    <template #actions>
      <VaButton preset="secondary" :disabled="loading" icon="refresh" @click="loadItems">
        {{ t('common.refresh') }}
      </VaButton>
      <VaButton color="primary" icon="add" @click="openCreate">
        {{ t('directories.memberships.add') }}
      </VaButton>
    </template>

    <VaAlert v-if="error" color="danger" outline>{{ error }}</VaAlert>

    <VaDataTable
      class="membership-directory-table app-table-actions-last-col"
      clickable
      hoverable
      :items="items"
      :columns="tableColumns"
      :loading="loading"
      @row:click="handleTableRowClick"
    >
      <template #cell(isActive)="{ rowData }">
        <StatusBadge
          :label="rowData.isActive !== false ? t('directories.memberships.activeYes') : t('directories.memberships.activeNo')"
          :tone="rowData.isActive !== false ? 'success' : 'neutral'"
        />
      </template>
      <template #cell(price)="{ rowData }">
        {{ formatPrice(rowData) }}
      </template>
      <template #cell(term)="{ rowData }">
        {{ formatTerm(rowData) }}
      </template>
      <template #cell(actions)="{ rowData }">
        <div class="app-actions-cell" @click.stop>
          <button
            type="button"
            role="switch"
            class="membership-row-switch"
            :class="{ 'membership-row-switch--on': rowData.isActive !== false }"
            :aria-checked="rowData.isActive !== false"
            :aria-label="rowData.isActive !== false ? t('directories.memberships.deactivateAction') : t('directories.memberships.activateAction')"
            :title="rowData.isActive !== false ? t('directories.memberships.deactivateAction') : t('directories.memberships.activateAction')"
            :disabled="tableBusy"
            @click="toggleActive(rowData)"
          >
            <span class="membership-row-switch__track" aria-hidden="true">
              <span class="membership-row-switch__thumb" />
            </span>
          </button>
          <VaButton
            size="large"
            preset="plain"
            :icon="TableActionIcon.edit"
            :aria-label="t('clients.edit')"
            :title="t('clients.edit')"
            :disabled="tableBusy"
            @click="openEdit(rowData)"
          />
          <VaButton
            size="large"
            color="danger"
            preset="plain"
            :icon="TableActionIcon.delete"
            :aria-label="t('clients.delete')"
            :title="t('clients.delete')"
            :disabled="tableBusy"
            @click="askDelete(rowData)"
          />
        </div>
      </template>
    </VaDataTable>

    <VaModal
      v-model="open"
      hide-default-actions
      no-padding
      max-width="min(92vw, 640px)"
      class="membership-editor-modal-shell"
    >
      <template #header />
      <form class="membership-editor" @submit.prevent="save">
        <header class="membership-editor__header">
          <div class="membership-editor__lead">
            <div class="membership-editor__icon" aria-hidden="true">
              <VaIcon name="card_membership" size="22px" />
            </div>
            <div class="membership-editor__head-copy">
              <h3 class="membership-editor__title">
                {{ editingId ? t('directories.memberships.editTitle') : t('directories.memberships.createTitle') }}
              </h3>
              <p class="membership-editor__summary" :class="{ 'membership-editor__summary--active': hasDurationValue }">
                {{ durationSummary }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="membership-editor__close"
            :disabled="saving"
            :aria-label="t('common.cancel')"
            @click="open = false"
          >
            <VaIcon name="close" size="22px" />
          </button>
        </header>

        <div class="membership-editor__body">
          <section class="membership-editor-card">
            <div class="membership-editor-card__grid membership-editor-card__grid--2">
              <VaInput
                :model-value="form.name"
                :label="t('directories.memberships.fields.name')"
                @update:model-value="(v) => (form.name = typeof v === 'string' ? v : '')"
              />
              <VaInput
                :model-value="form.price"
                :label="t('directories.memberships.fields.price')"
                type="number"
                min="0"
                step="0.01"
                @update:model-value="(v) => (form.price = typeof v === 'string' ? v : String(v ?? ''))"
              />
            </div>
          </section>

          <section class="membership-editor-card">
            <div class="membership-editor-card__section-head">
              <span class="membership-editor-card__label">{{ t('directories.memberships.presetsLabel') }}</span>
            </div>
            <div class="membership-preset-row" role="group" :aria-label="t('directories.memberships.presetsLabel')">
              <button
                v-for="preset in presets"
                :key="preset.label"
                type="button"
                class="membership-preset-chip"
                :class="{ 'membership-preset-chip--active': isPresetActive(preset) }"
                @click.prevent="applyPreset(preset.value, preset.unit)"
              >
                {{ preset.label }}
              </button>
            </div>
            <div class="membership-editor-card__grid membership-editor-card__grid--2 membership-editor-card__grid--duration">
              <VaCounter
                v-model="durationCounterModel"
                class="membership-duration-counter"
                :label="t('directories.memberships.fields.durationValue')"
                :disabled="isTrialDuration"
                manual-input
                :clearable="!isTrialDuration"
                clear-value=""
                :max="999"
                :step="1"
                buttons
                rounded
              />
              <VaSelect
                :model-value="form.durationUnit"
                :label="t('directories.memberships.fields.durationUnit')"
                :options="durationUnitOptions"
                value-by="value"
                text-by="text"
                @update:model-value="onDurationUnitChange"
              />
            </div>
          </section>

          <section class="membership-editor-card">
            <VaTextarea
              :model-value="form.description"
              :label="t('directories.memberships.fields.description')"
              :min-rows="2"
              :max-rows="4"
              @update:model-value="(v) => (form.description = typeof v === 'string' ? v : '')"
            />
            <div class="membership-status-field">
              <span class="membership-status-field__label">{{ t('directories.memberships.fields.isActive') }}</span>
              <div
                class="membership-status-segment"
                role="group"
                :aria-label="t('directories.memberships.fields.isActive')"
              >
                <button
                  type="button"
                  class="membership-status-segment__btn"
                  :class="{ 'membership-status-segment__btn--active': form.isActive }"
                  @click="form.isActive = true"
                >
                  {{ t('directories.memberships.activeYes') }}
                </button>
                <button
                  type="button"
                  class="membership-status-segment__btn"
                  :class="{ 'membership-status-segment__btn--active': !form.isActive }"
                  @click="form.isActive = false"
                >
                  {{ t('directories.memberships.activeNo') }}
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer class="membership-editor__footer">
          <VaButton preset="secondary" icon="close" :disabled="saving" @click="open = false">
            {{ t('common.cancel') }}
          </VaButton>
          <VaButton type="submit" icon="save" :disabled="!canSubmit" :loading="saving">
            {{ t('users.save') }}
          </VaButton>
        </footer>
      </form>
    </VaModal>

    <ConfirmModal
      v-model="deleteOpen"
      :title="t('directories.memberships.deleteTitle')"
      :message="t('directories.memberships.deleteMessage', { name: deletingItem?.name ?? '' })"
      :confirm-label="t('clients.delete')"
      :cancel-label="t('common.cancel')"
      :loading="deleting"
      danger
      @confirm="remove"
    />
  </AppPageCard>
</template>

<style scoped>
.membership-directory-table :deep(tbody tr) {
  cursor: pointer;
}

.membership-row-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.35rem;
  height: var(--app-action-icon-size);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.membership-row-switch:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.membership-row-switch__track {
  position: relative;
  display: block;
  width: 2.1rem;
  height: 1.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-muted) 42%, var(--app-border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-border) 88%, transparent);
  transition:
    background-color 0.18s ease,
    box-shadow 0.18s ease;
}

.membership-row-switch--on .membership-row-switch__track {
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 88%, white 12%) 0%,
    color-mix(in srgb, var(--app-accent) 74%, black 26%) 100%
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 35%, transparent);
}

.membership-row-switch__thumb {
  position: absolute;
  top: 0.12rem;
  left: 0.12rem;
  width: 0.96rem;
  height: 0.96rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-text) 18%, transparent);
  transition: transform 0.18s ease;
}

.membership-row-switch--on .membership-row-switch__thumb {
  transform: translateX(0.9rem);
}

.membership-row-switch:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
  border-radius: 999px;
}

.membership-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.membership-editor__header {
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

.membership-editor__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  min-width: 0;
}

.membership-editor__icon {
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

.membership-editor__head-copy {
  min-width: 0;
}

.membership-editor__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.3;
}

.membership-editor__summary {
  margin: 0.22rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--app-muted);
}

.membership-editor__summary--active {
  color: color-mix(in srgb, var(--app-text) 78%, var(--app-accent));
  font-weight: 600;
}

.membership-editor__close {
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

.membership-editor__close:hover:not(:disabled) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-border) 14%);
}

.membership-editor__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.membership-editor__body {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
}

.membership-editor-card {
  display: grid;
  gap: 0.7rem;
  padding: 0.8rem 0.85rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  background: color-mix(in srgb, var(--app-surface) 98%, white 2%);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-text) 4%, transparent);
}

.membership-editor-card__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.membership-editor-card__label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.membership-editor-card__grid {
  display: grid;
  gap: 0.75rem;
}

.membership-editor-card__grid--2 {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.membership-editor-card__grid--duration {
  margin-top: 0.15rem;
}

.membership-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.membership-preset-chip {
  padding: 0.38rem 0.72rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-text) 4%);
  color: color-mix(in srgb, var(--app-text) 68%, var(--app-muted));
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.membership-preset-chip:hover:not(.membership-preset-chip--active) {
  color: var(--app-text);
  border-color: color-mix(in srgb, var(--app-accent) 24%, transparent);
  background: color-mix(in srgb, var(--app-surface) 88%, var(--app-accent) 12%);
}

.membership-preset-chip--active {
  color: #fff;
  border-color: color-mix(in srgb, var(--app-accent) 62%, black 38%);
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 90%, white 10%) 0%,
    color-mix(in srgb, var(--app-accent) 76%, black 24%) 100%
  );
  box-shadow: 0 2px 8px color-mix(in srgb, var(--app-accent) 28%, transparent);
}

.membership-preset-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.membership-duration-counter {
  width: 100%;
  min-width: 0;
}

.membership-duration-counter :deep(.va-input-wrapper) {
  width: 100%;
}

.membership-status-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.membership-status-field__label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.membership-status-segment {
  display: inline-flex;
  align-self: flex-start;
  min-height: 2.15rem;
  padding: 0.2rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
}

.membership-status-segment__btn {
  min-width: 6.5rem;
  min-height: calc(2.15rem - 0.4rem);
  padding: 0.35rem 0.85rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 68%, var(--app-muted));
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.membership-status-segment__btn:hover:not(.membership-status-segment__btn--active) {
  background: color-mix(in srgb, var(--app-text) 5%, transparent);
  color: var(--app-text);
}

.membership-status-segment__btn--active {
  color: #fff;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 88%, white 12%) 0%,
    color-mix(in srgb, var(--app-accent) 74%, black 26%) 100%
  );
  box-shadow: 0 1px 4px color-mix(in srgb, var(--app-accent) 28%, transparent);
}

.membership-status-segment__btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.membership-editor__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface));
}

.membership-editor__footer :deep(.va-button) {
  min-height: 2.35rem;
  min-width: 7.5rem;
}

.membership-editor__footer :deep(.va-button[type='submit']) {
  min-width: 8.5rem;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--app-accent) 24%, transparent);
}

@media (max-width: 860px) {
  .membership-editor-card__grid--2,
  .membership-editor-card__grid--duration {
    grid-template-columns: 1fr;
  }

  .membership-status-segment {
    width: 100%;
  }

  .membership-status-segment__btn {
    flex: 1 1 0;
    min-width: 0;
  }

  .membership-editor__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .membership-editor__footer :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}
</style>
