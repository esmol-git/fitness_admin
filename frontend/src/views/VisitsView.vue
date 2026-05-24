<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGE_SIZES, type TablePageSizeOption } from '@/config/tablePagination'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppDateRangeFilter from '@/components/ui/AppDateRangeFilter.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppExportMenu from '@/components/ui/AppExportMenu.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useUiStore } from '@/stores/ui'
import { api } from '@/utils/api'
import { buildVisitsListApiParams } from '@/utils/visitsListApiParams'
import { ExportTooManyRowsError, fetchAllPaginatedItems } from '@/utils/fetchAllPages'
import { formatExportPeriodCaption } from '@/utils/exportPeriodCaption'
import { detectQuickDatePreset, quickDatePresetRange, type QuickDatePreset } from '@/utils/dateRangePresets'
import { downloadTableExport, type TableExportFormat } from '@/utils/tableExport'
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'

const { t } = useI18n()
const { init: notify } = useToast()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const VISIT_QUERY_KEYS = ['vSearch', 'vState', 'vFrom', 'vTo', 'vPage', 'vLimit', 'vSortBy', 'vSortOrder'] as const

const VISIT_SORT_KEYS = [
  'clientLastName',
  'clientPhone',
  'lockerNumber',
  'enteredAt',
  'exitedAt',
  'status',
] as const
type VisitSortKey = (typeof VISIT_SORT_KEYS)[number]

const loading = ref(false)
const error = ref<string | null>(null)
const total = ref(0)
const page = ref(1)
const limit = ref<number>(DEFAULT_TABLE_PAGE_LIMIT)
const sortBy = ref<VisitSortKey>('enteredAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

const visits = ref<
  Array<{
    id: string
    lockerNumber: string
    enteredAt: string
    exitedAt: string | null
    status: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED'
    closeReason?: string | null
    exitedBy?: { firstName?: string | null; lastName?: string | null; login?: string } | null
    client: {
      id: string
      firstName: string
      lastName: string
      middleName?: string | null
      phone: string
      cardNumber?: string | null
      photoUrl?: string | null
    }
  }>
>([])

const filters = reactive({
  search: '',
  state: '',
  from: '',
  to: '',
})

/** Статусы в фильтрах списка (без устаревших OVERDUE / FORCE_CLOSED). */
const VISIT_STATE_FILTER_OPTIONS = ['IN_GYM', 'LEFT'] as const
const VISITS_STATE_ALL = '__ALL__'

const visitStateFilterOptions = computed(() => [
  { value: VISITS_STATE_ALL, text: t('common.all') },
  { value: 'IN_GYM', text: t('visits.stateInGym') },
  { value: 'LEFT', text: t('visits.stateLeft') },
])

/** Vuestic: без sortable: true у колонки не рисуются стрелки и клик по заголовку не сортирует (по умолчанию false). */
const visitTableColumns = computed(() => [
  { key: 'clientLastName', label: t('clients.fullName'), sortable: true },
  { key: 'clientPhone', label: t('clients.phone'), sortable: true },
  { key: 'lockerNumber', label: t('visits.locker'), sortable: true },
  { key: 'enteredAt', label: t('visits.enteredAt'), sortable: true },
  { key: 'exitedAt', label: t('visits.exitedAt'), sortable: true },
  { key: 'status', label: t('clients.statusLabel'), sortable: true },
  { key: 'closeReason', label: t('visits.closeReasonLabel'), sortable: false },
  { key: 'exitedBy', label: t('visits.closedBy'), sortable: false },
])

let applyingFromRoute = false
let searchUrlTimer: ReturnType<typeof setTimeout> | null = null

const hasItems = computed(() => visits.value.length > 0)
const exportLoading = ref(false)
const visitsTodayCount = ref<number | null>(null)
const visitsTodayLoading = ref(false)
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

const sortDeviates = computed(() => sortBy.value !== 'enteredAt' || sortOrder.value !== 'desc')

const hasActiveFilters = computed(
  () =>
    Boolean(filters.search.trim()) ||
    Boolean(filters.state.trim()) ||
    Boolean(filters.from.trim()) ||
    Boolean(filters.to.trim()) ||
    page.value > 1 ||
    limit.value !== DEFAULT_TABLE_PAGE_LIMIT ||
    sortDeviates.value,
)

const activeDatePreset = computed(() => detectQuickDatePreset(filters.from, filters.to))

function parseStateFromQuery(raw: string): string {
  if (!raw) return ''
  return (VISIT_STATE_FILTER_OPTIONS as readonly string[]).includes(raw) ? raw : ''
}

function parsePage(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function parseLimit(raw: string): TablePageSizeOption {
  const n = Number(raw)
  return (TABLE_PAGE_SIZES as readonly number[]).includes(n) ? (n as TablePageSizeOption) : DEFAULT_TABLE_PAGE_LIMIT
}

function parseSortKey(raw: string): VisitSortKey {
  return (VISIT_SORT_KEYS as readonly string[]).includes(raw) ? (raw as VisitSortKey) : 'enteredAt'
}

function applyVisitsFromRoute() {
  filters.search = typeof route.query.vSearch === 'string' ? route.query.vSearch : ''
  const st = typeof route.query.vState === 'string' ? route.query.vState : ''
  filters.state = parseStateFromQuery(st)
  const fromRaw = typeof route.query.vFrom === 'string' ? route.query.vFrom.slice(0, 10) : ''
  const toRaw = typeof route.query.vTo === 'string' ? route.query.vTo.slice(0, 10) : ''
  filters.from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : ''
  filters.to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : ''

  const pageRaw = typeof route.query.vPage === 'string' ? route.query.vPage : ''
  page.value = pageRaw ? parsePage(pageRaw) : 1

  const limRaw = typeof route.query.vLimit === 'string' ? route.query.vLimit : ''
  limit.value = limRaw ? parseLimit(limRaw) : DEFAULT_TABLE_PAGE_LIMIT

  const sb = typeof route.query.vSortBy === 'string' ? route.query.vSortBy : ''
  sortBy.value = sb ? parseSortKey(sb) : 'enteredAt'

  const so = typeof route.query.vSortOrder === 'string' ? route.query.vSortOrder : ''
  sortOrder.value = so === 'asc' || so === 'desc' ? so : 'desc'
}

function pushVisitsQueryToUrl() {
  if (applyingFromRoute) return
  const base = normalizeRouteQuery(route.query)
  for (const k of VISIT_QUERY_KEYS) {
    delete base[k]
  }
  if (filters.search.trim()) base.vSearch = filters.search.trim()
  if (filters.state.trim()) base.vState = filters.state.trim()
  if (filters.from.trim()) base.vFrom = filters.from.trim().slice(0, 10)
  if (filters.to.trim()) base.vTo = filters.to.trim().slice(0, 10)
  if (page.value > 1) base.vPage = String(page.value)
  if (limit.value !== DEFAULT_TABLE_PAGE_LIMIT) base.vLimit = String(limit.value)
  if (sortBy.value !== 'enteredAt' || sortOrder.value !== 'desc') {
    base.vSortBy = sortBy.value
    base.vSortOrder = sortOrder.value
  }
  if (routeQueryEquals(base, route.query)) return
  void router.replace({ query: base })
}

function schedulePushSearchToUrl() {
  if (applyingFromRoute) return
  if (searchUrlTimer) clearTimeout(searchUrlTimer)
  searchUrlTimer = setTimeout(() => {
    page.value = 1
    pushVisitsQueryToUrl()
    searchUrlTimer = null
  }, 380)
}

function resetVisitsFilters() {
  applyingFromRoute = true
  filters.search = ''
  filters.state = ''
  filters.from = ''
  filters.to = ''
  page.value = 1
  limit.value = DEFAULT_TABLE_PAGE_LIMIT
  sortBy.value = 'enteredAt'
  sortOrder.value = 'desc'
  const base = normalizeRouteQuery(route.query)
  for (const k of VISIT_QUERY_KEYS) {
    delete base[k]
  }
  const noopNav = routeQueryEquals(base, route.query)
  void router.replace({ query: base }).finally(() => {
    void nextTick(() => {
      applyingFromRoute = false
    })
    if (noopNav) void refreshVisitsPage()
  })
}

watch(
  () => route.query,
  () => {
    if (searchUrlTimer) {
      clearTimeout(searchUrlTimer)
      searchUrlTimer = null
    }
    applyingFromRoute = true
    applyVisitsFromRoute()
    void refreshVisitsPage()
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
    schedulePushSearchToUrl()
  },
)

watch(
  () => [filters.state, filters.from, filters.to],
  () => {
    if (applyingFromRoute) return
    page.value = 1
    pushVisitsQueryToUrl()
  },
)

watch([page, limit, sortBy, sortOrder], () => {
  if (applyingFromRoute) return
  pushVisitsQueryToUrl()
})

function onFilterSearch(value: unknown) {
  filters.search = typeof value === 'string' ? value : ''
}

function onFilterState(value: unknown) {
  const v = typeof value === 'string' ? value : ''
  filters.state = v === VISITS_STATE_ALL || v === '' ? '' : v
}

function applyVisitDatePreset(preset: QuickDatePreset) {
  const range = quickDatePresetRange(preset)
  filters.from = range.from
  filters.to = range.to
  page.value = 1
  pushVisitsQueryToUrl()
}

function applyVisitStatePreset(state: '' | (typeof VISIT_STATE_FILTER_OPTIONS)[number]) {
  filters.state = state
  page.value = 1
  pushVisitsQueryToUrl()
}

function fullName(row: { firstName: string; lastName: string; middleName?: string | null }) {
  return [row.lastName, row.firstName, row.middleName].filter(Boolean).join(' ')
}

function actorName(row?: { firstName?: string | null; lastName?: string | null; login?: string } | null) {
  if (!row) return '—'
  const full = [row.lastName, row.firstName].filter(Boolean).join(' ').trim()
  return full || row.login || '—'
}

function closeReasonLabel(reason?: string | null) {
  if (!reason) return '—'
  return t(`visits.closeReason.${reason}`)
}

function closeReasonTone(
  reason?: string | null,
): 'success' | 'neutral' | 'warning' | 'danger' {
  if (!reason || reason === 'NORMAL') return 'neutral'
  if (reason === 'FOUND_LATER') return 'warning'
  if (reason === 'AUTO_TIMEOUT') return 'warning'
  if (reason === 'LOST_KEY' || reason === 'BLOCKED') return 'danger'
  if (reason === 'ADMIN_CORRECTION') return 'warning'
  return 'neutral'
}

function stateLabel(state: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED') {
  if (state === 'IN_GYM') return t('visits.stateInGym')
  if (state === 'OVERDUE') return t('visits.stateOverdue')
  if (state === 'FORCE_CLOSED') return t('visits.stateForceClosed')
  return t('visits.stateLeft')
}

function stateTone(state: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED'): 'success' | 'neutral' | 'warning' | 'danger' {
  if (state === 'IN_GYM') return 'success'
  if (state === 'OVERDUE') return 'warning'
  if (state === 'FORCE_CLOSED') return 'danger'
  return 'neutral'
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU')
}

async function exportVisitsTable(format: TableExportFormat) {
  if (!total.value) {
    notify({ color: 'warning', message: t('common.exportEmpty') })
    return
  }
  exportLoading.value = true
  try {
    const listQuery = {
      page: 1,
      limit: 200,
      search: filters.search,
      state: filters.state,
      from: filters.from,
      to: filters.to,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
    }
    const { items: exportItems } = await fetchAllPaginatedItems({
      pageSize: 200,
      fetchPage: async (pageNum, pageLimit) => {
        const params = buildVisitsListApiParams({ ...listQuery, page: pageNum, limit: pageLimit })
        const { data } = await api.get('/visits', { params })
        if (Array.isArray(data)) {
          return { items: data, total: data.length }
        }
        const typed = data as { items?: typeof visits.value; meta?: { total?: number } }
        const itemsList = Array.isArray(typed.items) ? typed.items : []
        const tot = Number.isFinite(typed.meta?.total) ? Number(typed.meta?.total) : itemsList.length
        return { items: itemsList, total: tot }
      },
    })
    if (!exportItems.length) {
      notify({ color: 'warning', message: t('common.exportEmpty') })
      return
    }
    const headers = [
      t('clients.fullName'),
      t('clients.phone'),
      t('visits.locker'),
      t('visits.enteredAt'),
      t('visits.exitedAt'),
      t('clients.statusLabel'),
      t('visits.closeReasonLabel'),
      t('visits.closedBy'),
    ]
    const rows = exportItems.map((row) => [
      fullName(row.client),
      row.client.phone,
      row.lockerNumber,
      formatDate(row.enteredAt),
      formatDate(row.exitedAt),
      stateLabel(row.status),
      closeReasonLabel(row.closeReason),
      actorName(row.exitedBy),
    ])
    const periodCaption = formatExportPeriodCaption(filters.from, filters.to, t)
    downloadTableExport({
      format,
      filenameBase: 'visits',
      headers,
      rows,
      preamble: periodCaption ? [periodCaption] : undefined,
      csvDelimiter: ';',
    })
    notify({ color: 'success', message: t('common.exported') })
  } catch (e: unknown) {
    if (e instanceof ExportTooManyRowsError) {
      notify({
        color: 'warning',
        message: t('common.exportTooMany', { total: e.total, max: e.max }),
      })
      return
    }
    notify({ color: 'danger', message: t('common.exportFailed') })
  } finally {
    exportLoading.value = false
  }
}

function parseVisitsListTotal(data: unknown): number {
  if (Array.isArray(data)) return data.length
  const typed = data as { items?: unknown[]; meta?: { total?: number } }
  if (Number.isFinite(typed.meta?.total)) return Number(typed.meta?.total)
  return Array.isArray(typed.items) ? typed.items.length : 0
}

async function loadVisitsTodayCount() {
  visitsTodayLoading.value = true
  try {
    const { from, to } = quickDatePresetRange('today')
    const { data } = await api.get('/visits', {
      params: { page: '1', limit: '1', from, to },
    })
    visitsTodayCount.value = parseVisitsListTotal(data)
  } catch {
    visitsTodayCount.value = null
  } finally {
    visitsTodayLoading.value = false
  }
}

async function refreshVisitsPage() {
  await Promise.all([loadVisits(), loadVisitsTodayCount()])
}

async function loadVisits() {
  loading.value = true
  error.value = null
  try {
    const params: Record<string, string> = {}
    params.page = String(page.value)
    params.limit = String(limit.value)
    params.sortBy = sortBy.value
    params.sortOrder = sortOrder.value
    if (filters.search.trim()) params.search = filters.search.trim()
    if (filters.state === 'IN_GYM' || filters.state === 'LEFT') {
      params.state = filters.state
    }
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    const { data } = await api.get('/visits', { params })
    if (Array.isArray(data)) {
      visits.value = data
      total.value = data.length
      return
    }
    const typedData = data as {
      items?: typeof visits.value
      meta?: { total?: number; page?: number; limit?: number }
    }
    visits.value = Array.isArray(typedData.items) ? typedData.items : []
    total.value = Number.isFinite(typedData.meta?.total) ? Number(typedData.meta?.total) : visits.value.length
  } catch (e: unknown) {
    error.value = resolveApiErrorMessage(e, { defaultMessage: t('visits.loadFailed') })
  } finally {
    loading.value = false
  }
}

watch([pages, limit], () => {
  if (page.value > pages.value) page.value = pages.value
})

watch(
  () => ui.visitsTableRefreshTick,
  () => {
    void refreshVisitsPage()
  },
)

function onSortByUpdate(next?: string) {
  if (!next || !(VISIT_SORT_KEYS as readonly string[]).includes(next)) return
  const key = next as VisitSortKey
  if (sortBy.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortBy.value = key
  sortOrder.value = 'asc'
  page.value = 1
}

function onSortOrderUpdate(next?: string) {
  sortOrder.value = next === 'desc' ? 'desc' : 'asc'
}

onBeforeUnmount(() => {
  if (searchUrlTimer) clearTimeout(searchUrlTimer)
})
</script>

<template>
  <AppPageCard :title="t('visits.title')">
    <template #title>
      <div class="visits-page-title">
        <span class="visits-page-title__text">{{ t('visits.title') }}</span>
        <div class="visits-today-badge" aria-live="polite">
          <VaIcon name="event_available" size="15px" class="visits-today-badge__icon" />
          <div class="visits-today-badge__content">
            <span class="visits-today-badge__label">{{ t('visits.todayCountLabel') }}</span>
            <span class="visits-today-badge__value">
              <template v-if="visitsTodayCount != null">{{ visitsTodayCount }}</template>
              <span v-else-if="visitsTodayLoading" class="visits-today-badge__placeholder">…</span>
              <span v-else>—</span>
            </span>
          </div>
        </div>
      </div>
    </template>
    <template #actions>
      <VaButton preset="secondary" icon="refresh" :loading="loading" @click="refreshVisitsPage">
        {{ t('common.refresh') }}
      </VaButton>
      <AppExportMenu
        :disabled="!total || loading"
        :loading="exportLoading"
        @export="exportVisitsTable"
      />
    </template>
    <template #filters>
      <AppListFiltersToolbar>
        <div class="visits-filters-grid">
          <VaInput
            :model-value="filters.search"
            :label="t('visits.searchLabel')"
            :placeholder="t('visits.searchPlaceholder')"
            clearable
            @update:model-value="onFilterSearch"
          />
          <VaSelect
            :model-value="filters.state === '' ? VISITS_STATE_ALL : filters.state"
            :label="t('visits.filterState')"
            :options="visitStateFilterOptions"
            value-by="value"
            text-by="text"
            @update:model-value="onFilterState"
          />
          <AppDateRangeFilter
            v-model:from="filters.from"
            v-model:to="filters.to"
            :label="t('visits.filterDateRange')"
            :range-placeholder="t('visits.dateRangePlaceholder')"
          />
        </div>
        <template #actions>
          <VaButton
            size="small"
            preset="secondary"
            icon="close"
            :disabled="!hasActiveFilters"
            @click="resetVisitsFilters"
          >
            {{ t('visits.resetFilters') }}
          </VaButton>
        </template>
      </AppListFiltersToolbar>
    </template>

    <div class="visits-presets-row">
      <div
        class="app-preset-strip preset-strip--date"
        :class="{ 'app-preset-strip--active': Boolean(activeDatePreset) }"
        role="group"
        :aria-label="t('visits.datePresetsLabel')"
      >
        <VaIcon name="event" size="16px" color="secondary" />
        <span class="app-preset-label">{{ t('visits.datePresetsLabel') }}</span>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === 'today' ? 'primary' : 'secondary'"
          @click="applyVisitDatePreset('today')"
        >
          {{ t('clients.presetToday') }}
        </VaButton>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === '7d' ? 'primary' : 'secondary'"
          @click="applyVisitDatePreset('7d')"
        >
          {{ t('clients.preset7Days') }}
        </VaButton>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="activeDatePreset === '30d' ? 'primary' : 'secondary'"
          @click="applyVisitDatePreset('30d')"
        >
          {{ t('clients.preset30Days') }}
        </VaButton>
      </div>
      <div
        class="app-preset-strip preset-strip--status"
        :class="{ 'app-preset-strip--active': Boolean(filters.state) }"
        role="group"
        :aria-label="t('visits.filterState')"
      >
        <VaIcon name="history" size="16px" color="secondary" />
        <span class="app-preset-label">{{ t('visits.filterState') }}</span>
        <VaButton
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="filters.state === '' ? 'primary' : 'secondary'"
          @click="applyVisitStatePreset('')"
        >
          {{ t('common.all') }}
        </VaButton>
        <VaButton
          v-for="state in VISIT_STATE_FILTER_OPTIONS"
          :key="state"
          type="button"
          size="small"
          class="app-preset-chip"
          :preset="filters.state === state ? 'primary' : 'secondary'"
          @click="applyVisitStatePreset(state)"
        >
          {{ stateLabel(state) }}
        </VaButton>
      </div>
    </div>

    <VaAlert v-if="error" color="danger" outline class="visits-error">{{ error }}</VaAlert>

    <AppDataTableShell :loading="loading" :has-items="hasItems" :show-pager="hasItems && pages > 1">
      <template #empty>
        <AppEmptyState
          icon="history"
          :title="t('visits.emptyTitle')"
          :description="hasActiveFilters ? t('visits.emptyDescFiltered') : t('visits.emptyDesc')"
        />
      </template>
      <VaDataTable
        :items="visits"
        :loading="loading"
        :sort-by="sortBy"
        :sorting-order="sortOrder"
        :columns="visitTableColumns"
        @update:sort-by="onSortByUpdate"
        @update:sorting-order="onSortOrderUpdate"
      >
        <template #cell(clientLastName)="{ rowData }">
          <div class="visits-client-name-cell">
            <div class="visits-client-name-cell__avatar" aria-hidden="true">
              <img
                v-if="clientPhotoDisplayUrl(rowData.client.photoUrl)"
                :src="clientPhotoDisplayUrl(rowData.client.photoUrl)"
                alt=""
                class="visits-client-name-cell__img"
              />
              <div v-else class="visits-client-name-cell__placeholder">
                <VaIcon name="person" size="16px" />
              </div>
            </div>
            <RouterLink
              class="visits-client-name-cell__link"
              :to="{ name: 'clients', query: { edit: rowData.client.id } }"
              :title="t('header.openClientProfile')"
            >
              {{ fullName(rowData.client) }}
            </RouterLink>
          </div>
        </template>
        <template #cell(clientPhone)="{ rowData }">{{ rowData.client.phone }}</template>
        <template #cell(enteredAt)="{ rowData }">{{ formatDate(rowData.enteredAt) }}</template>
        <template #cell(exitedAt)="{ rowData }">{{ formatDate(rowData.exitedAt) }}</template>
        <template #cell(status)="{ rowData }">
          <StatusBadge :label="stateLabel(rowData.status)" :tone="stateTone(rowData.status)" />
        </template>
        <template #cell(closeReason)="{ rowData }">
          <StatusBadge :label="closeReasonLabel(rowData.closeReason)" :tone="closeReasonTone(rowData.closeReason)" />
        </template>
        <template #cell(exitedBy)="{ rowData }">{{ actorName(rowData.exitedBy) }}</template>
      </VaDataTable>
      <template #pager>
        <AppTablePagerRow v-model:page="page" v-model:limit="limit" :pages="pages" :disabled="loading" />
      </template>
    </AppDataTableShell>
  </AppPageCard>
</template>

<style scoped>
.visits-page-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-width: 0;
}

.visits-page-title__text {
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  color: inherit;
}

.visits-today-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.32rem 0.75rem 0.32rem 0.55rem;
  border-radius: var(--app-radius-md);
  border: 1px solid color-mix(in srgb, var(--app-accent) 34%, var(--app-border));
  background: color-mix(in srgb, var(--app-accent) 11%, var(--app-surface));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--app-accent) 8%, transparent);
}

.visits-today-badge__icon {
  flex-shrink: 0;
  color: var(--app-accent);
}

.visits-today-badge__content {
  display: flex;
  flex-direction: column;
  gap: 0.02rem;
  min-width: 0;
}

.visits-today-badge__label {
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--app-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.visits-today-badge__value {
  font-size: 1.2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--app-accent);
}

.visits-today-badge__placeholder {
  color: var(--app-muted);
}

.visits-presets-row {
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

.visits-filters-grid {
  width: 100%;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(10rem, 1.25fr) minmax(9rem, 1fr) minmax(13rem, 1.35fr);
  align-items: end;
}

.visits-error {
  margin-bottom: var(--app-section-gap);
  width: 100%;
}

.visits-client-name-cell {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.visits-client-name-cell__avatar {
  flex-shrink: 0;
}

.visits-client-name-cell__img {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  object-fit: cover;
  display: block;
  border: 1px solid var(--app-border);
}

.visits-client-name-cell__placeholder {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border);
  color: var(--app-muted);
  background: color-mix(in srgb, var(--app-surface) 85%, var(--app-border));
}

.visits-client-name-cell__link {
  font-weight: 600;
  color: var(--va-primary);
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visits-client-name-cell__link:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .visits-filters-grid {
    grid-template-columns: 1fr;
  }
}

</style>
