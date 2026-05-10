<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { api } from '@/utils/api'

type MembershipItem = {
  id: string
  name: string
  price: number | null
  durationValue: number | null
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
  description: string | null
}

const { t } = useI18n()
const { init: notify } = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
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
  form.value = { name: '', price: '', durationValue: '', durationUnit: 'MONTH', description: '' }
  open.value = true
}

function openEdit(item: MembershipItem) {
  editingId.value = item.id
  const unit = item.durationUnit || 'MONTH'
  form.value = {
    name: item.name,
    price: item.price == null ? '' : String(item.price),
    durationValue:
      unit === 'TRIAL' ? '1' : item.durationValue == null ? '' : String(item.durationValue),
    durationUnit: unit,
    description: item.description ?? '',
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
  deletingItem.value = item
  deleteOpen.value = true
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
    }
    if (editingId.value) {
      await api.patch(`/membership-catalog/${editingId.value}`, payload)
      notify({ color: 'success', message: t('directories.memberships.updated') })
    } else {
      await api.post('/membership-catalog', payload)
      notify({ color: 'success', message: t('directories.memberships.created') })
    }
    open.value = false
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

    <VaDataTable class="app-table-actions-last-col" :items="items" :columns="[
      { key: 'name', label: t('directories.memberships.fields.name') },
      { key: 'price', label: t('directories.memberships.fields.price') },
      { key: 'term', label: t('directories.memberships.fields.term') },
      { key: 'description', label: t('directories.memberships.fields.description') },
      { key: 'actions', label: t('clients.actions') },
    ]" :loading="loading">
      <template #cell(price)="{ rowData }">
        {{ formatPrice(rowData) }}
      </template>
      <template #cell(term)="{ rowData }">
        {{ formatTerm(rowData) }}
      </template>
      <template #cell(description)="{ rowData }">
        {{ rowData.description || '—' }}
      </template>
      <template #cell(actions)="{ rowData }">
        <div class="app-actions-cell">
          <VaButton
            size="large"
            preset="plain"
            :icon="TableActionIcon.edit"
            :aria-label="t('clients.edit')"
            :title="t('clients.edit')"
            @click="openEdit(rowData)"
          />
          <VaButton
            size="large"
            color="danger"
            preset="plain"
            :icon="TableActionIcon.delete"
            :aria-label="t('clients.delete')"
            :title="t('clients.delete')"
            @click="askDelete(rowData)"
          />
        </div>
      </template>
    </VaDataTable>

    <VaModal v-model="open" hide-default-actions max-width="min(92vw, 640px)" class="membership-editor-modal">
      <template #header>
        <h3 class="membership-editor-modal__title">
          {{ editingId ? t('directories.memberships.editTitle') : t('directories.memberships.createTitle') }}
        </h3>
      </template>
      <form class="membership-editor-form" @submit.prevent="save">
        <div class="membership-editor-form__row">
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
        <div class="membership-editor-form__row">
          <div class="duration-group">
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
        </div>
        <div class="preset-block">
          <span class="preset-block__label">{{ t('directories.memberships.presetsLabel') }}</span>
          <div class="preset-row">
            <VaButton
              v-for="preset in presets"
              :key="preset.label"
              size="small"
              preset="secondary"
              @click.prevent="applyPreset(preset.value, preset.unit)"
            >
              {{ preset.label }}
            </VaButton>
          </div>
          <p
            class="duration-hint"
            :class="{ 'duration-hint--active': hasDurationValue }"
            role="status"
          >
            {{ durationSummary }}
          </p>
        </div>
        <VaTextarea
          :model-value="form.description"
          :label="t('directories.memberships.fields.description')"
          :min-rows="2"
          :max-rows="4"
          @update:model-value="(v) => (form.description = typeof v === 'string' ? v : '')"
        />
        <div class="app-modal-actions">
          <VaButton preset="secondary" :disabled="saving" @click="open = false">{{ t('common.cancel') }}</VaButton>
          <VaButton type="submit" :disabled="!canSubmit" :loading="saving">{{ t('users.save') }}</VaButton>
        </div>
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
.membership-editor-modal__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.3;
}

.membership-editor-form {
  display: grid;
  gap: 0.75rem;
  padding: 0.15rem 0.1rem 0.25rem;
}

.membership-editor-form__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
}

.duration-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  grid-column: 1 / -1;
}

.membership-duration-counter {
  width: 100%;
  min-width: 0;
}

.membership-duration-counter :deep(.va-input-wrapper) {
  width: 100%;
}

.preset-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem 0 0.1rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.preset-block__label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.duration-hint {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--app-muted);
}

.duration-hint--active {
  color: var(--app-text);
  font-weight: 500;
}

@media (max-width: 860px) {
  .membership-editor-form__row,
  .duration-group {
    grid-template-columns: 1fr;
  }
}
</style>
