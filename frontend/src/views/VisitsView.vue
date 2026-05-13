<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { DEFAULT_TABLE_PAGE_LIMIT, TABLE_PAGE_SIZES, type TablePageSizeOption } from '@/config/tablePagination'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useUiStore } from '@/stores/ui'
import { api } from '@/utils/api'
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'

const { t } = useI18n()
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

const VISIT_STATE_OPTIONS = ['IN_GYM', 'LEFT', 'OVERDUE', 'FORCE_CLOSED'] as const
const VISITS_STATE_ALL = '__ALL__'

const visitStateFilterOptions = computed(() => [
  { value: VISITS_STATE_ALL, text: t('common.all') },
  { value: 'IN_GYM', text: t('visits.stateInGym') },
  { value: 'LEFT', text: t('visits.stateLeft') },
  { value: 'OVERDUE', text: t('visits.stateOverdue') },
  { value: 'FORCE_CLOSED', text: t('visits.stateForceClosed') },
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

function toIsoDate(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return ''
}

function parseDateIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

const visitsDateRangeModel = computed(() => {
  const hasFrom = Boolean(filters.from)
  const hasTo = Boolean(filters.to)
  if (!hasFrom && !hasTo) return undefined
  return {
    start: hasFrom ? parseDateIso(filters.from) ?? undefined : undefined,
    end: hasTo ? parseDateIso(filters.to) ?? undefined : undefined,
  }
})

function parseStateFromQuery(raw: string): string {
  if (!raw) return ''
  return (VISIT_STATE_OPTIONS as readonly string[]).includes(raw) ? raw : ''
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
    if (noopNav) void loadVisits()
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
    void loadVisits()
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

function onFilterDateRange(value: unknown) {
  if (value == null || value === '' || value === false) {
    filters.from = ''
    filters.to = ''
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    filters.from = a != null && a !== '' ? toIsoDate(a) : ''
    filters.to = b != null && b !== '' ? toIsoDate(b) : ''
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    filters.from = r.start != null && r.start !== '' ? toIsoDate(r.start) : ''
    filters.to = r.end != null && r.end !== '' ? toIsoDate(r.end) : ''
  }
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

function exportCsv() {
  if (!visits.value.length) return
  const rows = visits.value.map((row) => [
    fullName(row.client),
    row.client.phone,
    row.lockerNumber,
    formatDate(row.enteredAt),
    formatDate(row.exitedAt),
    stateLabel(row.status),
    closeReasonLabel(row.closeReason),
    actorName(row.exitedBy),
  ])
  const header = [
    t('clients.fullName'),
    t('clients.phone'),
    t('visits.locker'),
    t('visits.enteredAt'),
    t('visits.exitedAt'),
    t('clients.statusLabel'),
    t('visits.closeReasonLabel'),
    t('visits.closedBy'),
  ]
  const csv = [header, ...rows]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `visits-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
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
    if (filters.state === 'IN_GYM' || filters.state === 'LEFT' || filters.state === 'OVERDUE' || filters.state === 'FORCE_CLOSED') {
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
    void loadVisits()
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
    <template #actions>
      <VaButton preset="secondary" icon="refresh" :loading="loading" @click="loadVisits">
        {{ t('common.refresh') }}
      </VaButton>
      <VaButton preset="secondary" icon="download" :disabled="!hasItems" @click="exportCsv">
        {{ t('reports.exportCsv') }}
      </VaButton>
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
          <VaDateInput
            mode="range"
            :model-value="visitsDateRangeModel"
            :label="t('visits.filterDateRange')"
            :placeholder="t('visits.dateRangePlaceholder')"
            clearable
            @update:model-value="onFilterDateRange"
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
.visits-filters-grid {
  width: 100%;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(12rem, 1.65fr) minmax(11rem, 1fr) minmax(14rem, 1.45fr);
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
