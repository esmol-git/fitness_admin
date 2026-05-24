<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { detectQuickDatePreset, quickDatePresetRange, type QuickDatePreset } from '@/utils/dateRangePresets'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'vuestic-ui'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGE_SIZES, type TablePageSizeOption } from '@/config/tablePagination'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppDateRangeFilter from '@/components/ui/AppDateRangeFilter.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppExportMenu from '@/components/ui/AppExportMenu.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useUiStore } from '@/stores/ui'
import { api } from '@/utils/api'
import { copyTextToClipboard } from '@/utils/clipboard'
import { formatExportPeriodCaption } from '@/utils/exportPeriodCaption'
import { downloadTableExport, type TableExportFormat } from '@/utils/tableExport'
import type { LocationQuery } from 'vue-router'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { init: notify } = useToast()
const ui = useUiStore()

const PAY_QUERY_KEYS = ['paySearch', 'payStatus', 'payFrom', 'payTo', 'payPage', 'payLimit'] as const

const PAYMENTS_STATUS_ALL = '__ALL__'
const paymentStatusOptions = ['PENDING', 'PAID', 'REFUNDED'] as const

type ProcessedBy = { firstName?: string | null; lastName?: string | null } | null

type PaymentApiRow = {
  id: string
  clientId?: string | null
  contractDocumentId?: string | null
  amount: string | number
  paidAt: string
  status: string
  channel?: 'CASH' | 'NON_CASH' | string | null
  comment?: string | null
  contract?: { id: string; contractNumber: string; s3Url?: string | null } | null
  client?: {
    id: string
    firstName: string
    lastName: string
    middleName?: string | null
  } | null
  processedBy?: ProcessedBy
}

type PaymentRow = PaymentApiRow & {
  clientShort: string
  contractNumber: string
  managerName: string
}

const loading = ref(false)
const formError = ref<string | null>(null)
const page = ref(1)
const limit = ref<number>(DEFAULT_TABLE_PAGE_LIMIT)
const sortBy = ref<
  'clientShort' | 'amount' | 'status' | 'contractNumber' | 'paidAt' | 'managerName'
>('paidAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

const filters = reactive({
  search: '',
  status: '' as '' | (typeof paymentStatusOptions)[number],
  from: '',
  to: '',
})

const payments = ref<PaymentRow[]>([])
const pages = computed(() => Math.max(1, Math.ceil(payments.value.length / limit.value)))
const hasItems = computed(() => payments.value.length > 0)
const exportLoading = ref(false)

let applyingFromRoute = false
let searchUrlTimer: ReturnType<typeof setTimeout> | null = null
let lastFilterSignature: string | undefined = undefined
/** Имя маршрута до последнего захода на «Платежи» — чтобы при возврате с карточки клиента список перезагрузился при том же query. */
let routeNameBeforePayments: typeof route.name | undefined

const paymentStatusFilterOptions = computed(() => [
  { value: PAYMENTS_STATUS_ALL, text: t('common.all') },
  ...paymentStatusOptions.map((s) => ({
    value: s,
    text: paymentStatusLabel(s),
  })),
])

const hasActiveFilters = computed(
  () =>
    Boolean(filters.search.trim()) ||
    Boolean(filters.status) ||
    Boolean(filters.from.trim()) ||
    Boolean(filters.to.trim()) ||
    page.value > 1 ||
    limit.value !== DEFAULT_TABLE_PAGE_LIMIT,
)

const activeDatePreset = computed(() => detectQuickDatePreset(filters.from, filters.to))

function paymentChannelLabel(channel?: string | null): string {
  const c = (channel || 'CASH').trim().toUpperCase()
  return c === 'NON_CASH' ? t('clients.paymentChannelNonCash') : t('clients.paymentChannelCash')
}

function paymentStatusLabel(value: string) {
  const normalized = value === 'REFUND' ? 'REFUNDED' : value
  return t(`contracts.paymentStatuses.${normalized}`)
}

function paymentStatusTone(value: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (value === 'PAID') return 'success'
  if (value === 'REFUNDED' || value === 'REFUND') return 'warning'
  return 'info'
}

function formatManager(p: ProcessedBy) {
  if (!p) return '—'
  const full = [p.lastName, p.firstName].filter(Boolean).join(' ').trim()
  return full || '—'
}

/** «Иванов И.И.» */
function formatClientShort(c: PaymentApiRow['client']): string {
  if (!c) return '—'
  const ln = c.lastName?.trim() || ''
  const fi = c.firstName?.trim() ? `${c.firstName.trim().charAt(0).toLocaleUpperCase('ru-RU')}.` : ''
  const mi = c.middleName?.trim() ? `${c.middleName.trim().charAt(0).toLocaleUpperCase('ru-RU')}.` : ''
  const initials = `${fi}${mi}`
  if (!ln && !initials) return '—'
  if (!ln) return initials
  if (!initials) return ln
  return `${ln} ${initials}`
}

function mapRows(list: PaymentApiRow[]): PaymentRow[] {
  return list.map((p) => ({
    ...p,
    clientShort: formatClientShort(p.client ?? null),
    contractNumber: p.contract?.contractNumber?.trim() ?? '',
    managerName: formatManager(p.processedBy ?? null),
  }))
}

function parseLimit(raw: string): TablePageSizeOption {
  const n = Number(raw)
  return (TABLE_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as TablePageSizeOption)
    : DEFAULT_TABLE_PAGE_LIMIT
}

function parseStatusFromQuery(raw: string): '' | (typeof paymentStatusOptions)[number] {
  if (!raw) return ''
  const u = raw.toUpperCase()
  return (paymentStatusOptions as readonly string[]).includes(u)
    ? (u as (typeof paymentStatusOptions)[number])
    : ''
}

function filterSignatureFromQuery(q: LocationQuery): string {
  const s = (key: string) => {
    const v = q[key]
    const x = Array.isArray(v) ? v[0] : v
    return x != null && x !== '' ? String(x) : ''
  }
  return [s('paySearch'), s('payStatus'), s('payFrom'), s('payTo')].join('|')
}

function applyPaymentsFromRoute() {
  filters.search = typeof route.query.paySearch === 'string' ? route.query.paySearch : ''
  const st = typeof route.query.payStatus === 'string' ? route.query.payStatus : ''
  filters.status = parseStatusFromQuery(st)
  const fromRaw = typeof route.query.payFrom === 'string' ? route.query.payFrom.slice(0, 10) : ''
  const toRaw = typeof route.query.payTo === 'string' ? route.query.payTo.slice(0, 10) : ''
  filters.from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : ''
  filters.to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : ''

  const pageRaw = typeof route.query.payPage === 'string' ? Number(route.query.payPage) : NaN
  page.value = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const limRaw = typeof route.query.payLimit === 'string' ? route.query.payLimit : ''
  limit.value = limRaw ? parseLimit(limRaw) : DEFAULT_TABLE_PAGE_LIMIT
}

function pushPaymentsQueryToUrl() {
  if (applyingFromRoute) return
  const base = normalizeRouteQuery(route.query)
  for (const k of PAY_QUERY_KEYS) {
    delete base[k]
  }
  if (filters.search.trim()) base.paySearch = filters.search.trim()
  if (filters.status) base.payStatus = filters.status
  if (filters.from.trim()) base.payFrom = filters.from.trim().slice(0, 10)
  if (filters.to.trim()) base.payTo = filters.to.trim().slice(0, 10)
  if (page.value > 1) base.payPage = String(page.value)
  if (limit.value !== DEFAULT_TABLE_PAGE_LIMIT) base.payLimit = String(limit.value)
  if (routeQueryEquals(base, route.query)) return
  void router.replace({ query: base })
}

function scheduleDebouncedPaySearchUrl() {
  if (applyingFromRoute) return
  if (searchUrlTimer) clearTimeout(searchUrlTimer)
  searchUrlTimer = setTimeout(() => {
    page.value = 1
    pushPaymentsQueryToUrl()
    searchUrlTimer = null
  }, 380)
}

const sortedPayments = computed(() => {
  const list = [...payments.value]
  const factor = sortOrder.value === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    const key = sortBy.value
    if (key === 'amount') {
      const d = Number(a.amount) - Number(b.amount)
      if (d !== 0) return d * factor
      return String(a.id).localeCompare(String(b.id)) * factor
    }
    if (key === 'paidAt') {
      const ta = new Date(a.paidAt).getTime()
      const tb = new Date(b.paidAt).getTime()
      const na = Number.isFinite(ta) ? ta : 0
      const nb = Number.isFinite(tb) ? tb : 0
      const d = na - nb
      if (d !== 0) return d * factor
      return String(a.id).localeCompare(String(b.id)) * factor
    }
    const av = String(a[key] ?? '')
    const bv = String(b[key] ?? '')
    const c = av.localeCompare(bv, 'ru')
    if (c !== 0) return c * factor
    return String(a.id).localeCompare(String(b.id)) * factor
  })
})

const pagedPayments = computed(() => {
  const start = (page.value - 1) * limit.value
  return sortedPayments.value.slice(start, start + limit.value)
})

watch([pages, limit], () => {
  if (page.value > pages.value) page.value = pages.value
})

watch(
  () => ({ name: route.name, query: route.query }),
  () => {
    if (route.name !== 'payments') {
      routeNameBeforePayments = route.name
      return
    }
    if (searchUrlTimer) {
      clearTimeout(searchUrlTimer)
      searchUrlTimer = null
    }
    applyingFromRoute = true
    applyPaymentsFromRoute()
    const sig = filterSignatureFromQuery(route.query)
    const reenteredFromOtherPage =
      routeNameBeforePayments !== undefined && routeNameBeforePayments !== 'payments'
    const shouldLoad =
      reenteredFromOtherPage || lastFilterSignature === undefined || sig !== lastFilterSignature
    if (shouldLoad) {
      lastFilterSignature = sig
      void loadPayments()
    }
    routeNameBeforePayments = 'payments'
    void nextTick(() => {
      applyingFromRoute = false
    })
  },
  { immediate: true },
)

watch(
  () => filters.search,
  () => {
    if (applyingFromRoute) return
    scheduleDebouncedPaySearchUrl()
  },
)

watch(
  () => [filters.status, filters.from, filters.to],
  () => {
    if (applyingFromRoute) return
    page.value = 1
    pushPaymentsQueryToUrl()
  },
)

watch([page, limit], () => {
  if (applyingFromRoute) return
  pushPaymentsQueryToUrl()
})

watch(
  () => ui.paymentsTableRefreshTick,
  (tick) => {
    if (tick === 0) return
    if (route.name !== 'payments') return
    void loadPayments()
  },
)

function formatExportDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU')
}

async function exportPaymentsTable(format: TableExportFormat) {
  const rowsSource = sortedPayments.value
  if (!rowsSource.length) {
    notify({ color: 'warning', message: t('common.exportEmpty') })
    return
  }
  exportLoading.value = true
  try {
    const headers = [
      t('payments.columnClient'),
      t('payments.columnAmount'),
      t('payments.columnChannel'),
      t('clients.statusLabel'),
      t('payments.columnContract'),
      t('payments.columnPaidAt'),
      t('payments.columnManager'),
    ]
    const rows = rowsSource.map((row) => [
      row.clientShort,
      Number(row.amount).toFixed(2),
      paymentChannelLabel(row.channel),
      paymentStatusLabel(row.status),
      row.contractNumber || '—',
      formatExportDateTime(row.paidAt),
      row.managerName,
    ])
    const periodCaption = formatExportPeriodCaption(filters.from, filters.to, t)
    downloadTableExport({
      format,
      filenameBase: 'payments',
      headers,
      rows,
      preamble: periodCaption ? [periodCaption] : undefined,
      csvDelimiter: ';',
    })
    notify({ color: 'success', message: t('common.exported') })
  } catch {
    notify({ color: 'danger', message: t('common.exportFailed') })
  } finally {
    exportLoading.value = false
  }
}

async function loadPayments() {
  loading.value = true
  formError.value = null
  try {
    const params: Record<string, string> = {}
    const q = filters.search.trim()
    if (q) params.q = q
    if (filters.status) params.status = filters.status
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    const { data } = await api.get<PaymentApiRow[]>('/payments', { params })
    payments.value = mapRows(Array.isArray(data) ? data : [])
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('payments.loadFailed'),
      byCode: {
        INVALID_DATE_FILTER: t('payments.invalidDateFilter'),
        INVALID_DATE_RANGE: t('payments.invalidDateRange'),
      },
    })
  } finally {
    loading.value = false
  }
}

function applyStatusPreset(status: string) {
  filters.status = status as typeof filters.status
  page.value = 1
  pushPaymentsQueryToUrl()
}

function onFilterSearch(value: unknown) {
  filters.search = typeof value === 'string' ? value : ''
}

function onFilterStatus(value: unknown) {
  const v = typeof value === 'string' ? value : ''
  filters.status = v === PAYMENTS_STATUS_ALL || v === '' ? '' : (v as typeof filters.status)
  page.value = 1
  pushPaymentsQueryToUrl()
}

function applyDatePreset(preset: QuickDatePreset) {
  const range = quickDatePresetRange(preset)
  filters.from = range.from
  filters.to = range.to
  page.value = 1
  pushPaymentsQueryToUrl()
}

function onPaymentsDateFilterChange() {
  page.value = 1
  pushPaymentsQueryToUrl()
}

function resetFilters() {
  applyingFromRoute = true
  filters.search = ''
  filters.status = ''
  filters.from = ''
  filters.to = ''
  page.value = 1
  limit.value = DEFAULT_TABLE_PAGE_LIMIT
  sortBy.value = 'paidAt'
  sortOrder.value = 'desc'
  const base = normalizeRouteQuery(route.query)
  for (const k of PAY_QUERY_KEYS) {
    delete base[k]
  }
  const noopNav = routeQueryEquals(base, route.query)
  void router.replace({ query: base }).finally(() => {
    void nextTick(() => {
      applyingFromRoute = false
    })
    if (noopNav) {
      lastFilterSignature = filterSignatureFromQuery(route.query)
      void loadPayments()
    }
  })
}

function onSortByUpdate(next?: string) {
  if (!next) return
  if (sortBy.value === next) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortBy.value = next as typeof sortBy.value
  sortOrder.value = next === 'paidAt' ? 'desc' : 'asc'
}

function onSortOrderUpdate(next?: string) {
  sortOrder.value = next === 'desc' ? 'desc' : 'asc'
}

async function openContract(contractId?: string) {
  if (!contractId) return
  try {
    const { data } = await api.get<{ url: string | null }>(`/contracts/${contractId}/open-url`)
    if (!data?.url) return
    window.open(data.url, '_blank')
  } catch {
    notify({ color: 'danger', message: t('clients.contractOpenFailed') })
  }
}

async function copyContractNumber(raw: string) {
  const num = raw.trim()
  if (!num) return
  const copied = await copyTextToClipboard(num)
  if (copied) {
    notify({ color: 'success', message: t('common.copied') })
  } else {
    notify({ color: 'danger', message: t('common.copyFailed') })
  }
}

onBeforeUnmount(() => {
  if (searchUrlTimer) clearTimeout(searchUrlTimer)
})
</script>

<template>
  <AppPageCard :title="t('payments.title')">
    <template #actions>
      <VaButton preset="secondary" icon="refresh" :loading="loading" @click="loadPayments">
        {{ t('common.refresh') }}
      </VaButton>
      <AppExportMenu :disabled="!hasItems || loading" :loading="exportLoading" @export="exportPaymentsTable" />
    </template>
    <template #filters>
      <div class="payments-filter-bar">
        <AppListFiltersToolbar>
          <div class="payments-filters-grid">
            <VaInput
              :model-value="filters.search"
              :label="t('payments.searchLabel')"
              :placeholder="t('payments.searchPlaceholder')"
              clearable
              @update:model-value="onFilterSearch"
            />
            <VaSelect
              :model-value="filters.status === '' ? PAYMENTS_STATUS_ALL : filters.status"
              :label="t('payments.filterStatus')"
              :options="paymentStatusFilterOptions"
              value-by="value"
              text-by="text"
              @update:model-value="onFilterStatus"
            />
            <AppDateRangeFilter
              v-model:from="filters.from"
              v-model:to="filters.to"
              :label="t('payments.filterDateRange')"
              :range-placeholder="t('payments.filterDateRangePlaceholder')"
              @change="onPaymentsDateFilterChange"
              @cleared="onPaymentsDateFilterChange"
            />
          </div>
          <template #actions>
            <VaButton
              size="small"
              preset="secondary"
              icon="close"
              :disabled="!hasActiveFilters"
              @click="resetFilters"
            >
              {{ t('visits.resetFilters') }}
            </VaButton>
          </template>
        </AppListFiltersToolbar>
      </div>
    </template>

    <VaAlert v-if="formError" color="danger" outline class="payments-error">
      {{ formError }}
    </VaAlert>

    <div class="payments-presets-row">
      <div
        class="app-preset-strip preset-strip--date"
        :class="{ 'app-preset-strip--active': Boolean(activeDatePreset) }"
        role="group"
        :aria-label="t('payments.datePresetsLabel')"
      >
        <VaIcon name="event" size="16px" color="secondary" />
        <span class="app-preset-label">{{ t('payments.datePresetsLabel') }}</span>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === 'today' ? 'primary' : 'secondary'"
          @click="applyDatePreset('today')"
        >
          {{ t('clients.presetToday') }}
        </VaButton>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === '7d' ? 'primary' : 'secondary'"
          @click="applyDatePreset('7d')"
        >
          {{ t('clients.preset7Days') }}
        </VaButton>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === '30d' ? 'primary' : 'secondary'"
          @click="applyDatePreset('30d')"
        >
          {{ t('clients.preset30Days') }}
        </VaButton>
      </div>
      <div
        class="app-preset-strip preset-strip--status"
        :class="{ 'app-preset-strip--active': Boolean(filters.status) }"
        role="group"
        :aria-label="t('payments.filterStatus')"
      >
        <VaIcon name="payments" size="16px" color="secondary" />
        <span class="app-preset-label">{{ t('payments.filterStatus') }}</span>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="filters.status === '' ? 'primary' : 'secondary'"
          @click="applyStatusPreset('')"
        >
          {{ t('common.all') }}
        </VaButton>
        <VaButton
          v-for="status in paymentStatusOptions"
          :key="status"
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="filters.status === status ? 'primary' : 'secondary'"
          @click="applyStatusPreset(status)"
        >
          {{ paymentStatusLabel(status) }}
        </VaButton>
      </div>
    </div>

    <AppDataTableShell :loading="loading" :has-items="hasItems" :show-pager="hasItems && pages > 1">
      <template #empty>
        <AppEmptyState
          icon="payments"
          :title="t('payments.emptyTitle')"
          :description="hasActiveFilters ? t('payments.emptyDescFiltered') : t('payments.emptyDesc')"
        />
      </template>
      <VaDataTable
        class="app-table-actions-last-col"
        :items="pagedPayments"
        :loading="loading"
        :sort-by="sortBy"
        :sorting-order="sortOrder"
        :columns="[
          { key: 'clientShort', label: t('payments.columnClient') },
          { key: 'amount', label: t('payments.columnAmount') },
          { key: 'channel', label: t('payments.columnChannel') },
          { key: 'status', label: t('clients.statusLabel') },
          { key: 'contractNumber', label: t('payments.columnContract') },
          { key: 'paidAt', label: t('payments.columnPaidAt') },
          { key: 'managerName', label: t('payments.columnManager') },
          { key: 'actions', label: t('clients.actions') },
        ]"
        @update:sort-by="onSortByUpdate"
        @update:sorting-order="onSortOrderUpdate"
      >
        <template #cell(clientShort)="{ rowData }">{{ rowData.clientShort }}</template>
        <template #cell(amount)="{ rowData }">{{ Number(rowData.amount).toFixed(2) }}</template>
        <template #cell(channel)="{ rowData }">{{ paymentChannelLabel(rowData.channel) }}</template>
        <template #cell(paidAt)="{ rowData }">{{ new Date(rowData.paidAt).toLocaleString('ru-RU') }}</template>
        <template #cell(status)="{ rowData }">
          <StatusBadge :label="paymentStatusLabel(rowData.status)" :tone="paymentStatusTone(rowData.status)" />
        </template>
        <template #cell(contractNumber)="{ rowData }">
          <div class="payments-contract-cell">
            <span class="payments-contract-cell__text">{{ rowData.contractNumber || '—' }}</span>
            <VaButton
              v-if="rowData.contractNumber"
              class="payments-contract-cell__copy"
              preset="plain"
              icon="content_copy"
              size="small"
              :title="t('payments.copyContract')"
              @click.stop="copyContractNumber(rowData.contractNumber)"
            />
          </div>
        </template>
        <template #cell(actions)="{ rowData }">
          <div class="app-actions-cell">
            <VaButton
              size="large"
              preset="plain"
              :icon="TableActionIcon.viewDocument"
              :disabled="!rowData.contract?.id"
              :title="t('contracts.openLinkedContract')"
              @click="openContract(rowData.contract?.id)"
            />
          </div>
        </template>
      </VaDataTable>
      <template #pager>
        <AppTablePagerRow v-model:page="page" v-model:limit="limit" :pages="pages" :disabled="loading" />
      </template>
    </AppDataTableShell>
  </AppPageCard>
</template>

<style scoped>
.payments-filter-bar {
  width: 100%;
}

.payments-filter-bar :deep(.va-input-wrapper) {
  background: transparent !important;
}

.payments-filter-bar :deep(.va-input-wrapper__field::after) {
  background: color-mix(in srgb, var(--app-surface) 97%, white 3%) !important;
  opacity: 1 !important;
}

.payments-filter-bar :deep(.va-input-label) {
  background: transparent !important;
  box-shadow: none !important;
}

.payments-filter-bar :deep(.va-select),
.payments-filter-bar :deep(.va-date-input) {
  background: transparent;
}

.payments-filters-grid {
  width: 100%;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(10rem, 1.25fr) minmax(9rem, 1fr) minmax(13rem, 1.35fr);
  align-items: end;
}

.payments-presets-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.65rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.4rem 0 0.2rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
  margin-top: 0.05rem;
}

.preset-strip--date,
.preset-strip--status {
  flex: 1 1 18rem;
  min-width: 18rem;
}

.payments-error {
  margin-bottom: var(--app-section-gap);
  width: 100%;
}

.payments-contract-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
}

.payments-contract-cell__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payments-contract-cell__copy {
  flex-shrink: 0;
}

@media (max-width: 960px) {
  .payments-filters-grid {
    grid-template-columns: 1fr;
  }
}
</style>
