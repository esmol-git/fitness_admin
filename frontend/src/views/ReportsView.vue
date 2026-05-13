<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { LocationQuery } from 'vue-router'
import { api } from '@/utils/api'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { routeQueryEquals } from '@/composables/tableListUrlQueryUtils'

type ReportsOverview = {
  period: { from: string | null; to: string | null }
  finance: {
    paidAmount: number
    paidCount: number
    trendPct: number
    refundAmount: number
    refundCount: number
    installmentPaidAmount: number
    installmentPaidCount: number
    failedAmount: number
    failedCount: number
  }
  clients: {
    totalClients: number
    activeClients: number
    activeClientsSharePct: number
  }
  activity: {
    visitSessionsCount: number
    newClientsCount: number
    contractsCreatedCount: number
  }
}

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { init: notify } = useToast()
const loading = ref(false)
const loadError = ref<string | null>(null)
const overview = ref<ReportsOverview | null>(null)
const filters = reactive({
  from: '',
  to: '',
})
const periodPreset = ref<'today' | '7d' | '30d' | 'month' | 'quarter' | 'custom'>('today')
let loadTimer: ReturnType<typeof setTimeout> | null = null

/** Не реагировать на query при собственном router.replace (избегаем лишних запросов). */
let ignoreNextRouteQueryWatch = false

const REPORT_PRESETS = ['today', '7d', '30d', 'month', 'quarter', 'custom'] as const
type ReportPreset = (typeof REPORT_PRESETS)[number]

type ParsedReportsQuery =
  | { mode: 'empty' }
  | { mode: 'invalid' }
  | { mode: 'preset'; preset: Exclude<ReportPreset, 'custom'> }
  | { mode: 'custom'; from: string; to: string }

function firstQueryString(q: LocationQuery, key: string): string {
  const v = q[key]
  if (Array.isArray(v)) return String(v[0] ?? '')
  return v != null ? String(v) : ''
}

function isValidIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDateIso(s) != null
}

function parseReportsRouteQuery(q: LocationQuery): ParsedReportsQuery {
  const periodRaw = firstQueryString(q, 'period').toLowerCase()
  const fromRaw = firstQueryString(q, 'from')
  const toRaw = firstQueryString(q, 'to')

  if (isValidIsoDateString(fromRaw) && isValidIsoDateString(toRaw) && fromRaw <= toRaw) {
    return { mode: 'custom', from: fromRaw, to: toRaw }
  }

  if (!periodRaw && !fromRaw && !toRaw) return { mode: 'empty' }

  if (
    periodRaw === 'today' ||
    periodRaw === '7d' ||
    periodRaw === '30d' ||
    periodRaw === 'month' ||
    periodRaw === 'quarter'
  ) {
    return { mode: 'preset', preset: periodRaw }
  }

  return { mode: 'invalid' }
}

function buildReportsRouteQuery(): Record<string, string> {
  if (periodPreset.value === 'custom' && filters.from && filters.to) {
    return { period: 'custom', from: filters.from, to: filters.to }
  }
  if (periodPreset.value !== 'custom') {
    return { period: periodPreset.value }
  }
  return { period: 'today' }
}

function reportsStateMatchesParsed(parsed: ParsedReportsQuery): boolean {
  switch (parsed.mode) {
    case 'preset':
      return periodPreset.value === parsed.preset
    case 'custom':
      return (
        periodPreset.value === 'custom' &&
        filters.from === parsed.from &&
        filters.to === parsed.to
      )
    default:
      return false
  }
}

async function syncReportsFiltersToUrl() {
  const next = buildReportsRouteQuery()
  if (routeQueryEquals(next, route.query)) return
  ignoreNextRouteQueryWatch = true
  try {
    await router.replace({ query: next })
  } finally {
    await nextTick()
    ignoreNextRouteQueryWatch = false
  }
}

function applyRouteQuery(parsed: ParsedReportsQuery) {
  switch (parsed.mode) {
    case 'empty':
    case 'invalid':
      applyPresetInner('today')
      scheduleLoadReports(0)
      break
    case 'preset':
      applyPresetInner(parsed.preset)
      scheduleLoadReports(0)
      break
    case 'custom':
      periodPreset.value = 'custom'
      filters.from = parsed.from
      filters.to = parsed.to
      scheduleLoadReports(0)
      break
  }
}

function applyPresetInner(preset: 'today' | '7d' | '30d' | 'month' | 'quarter') {
  periodPreset.value = preset
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') {
    const iso = dateToIso(end)
    filters.from = iso
    filters.to = iso
    return
  }
  let start = new Date(end)
  if (preset === '7d') start.setDate(end.getDate() - 6)
  if (preset === '30d') start.setDate(end.getDate() - 29)
  if (preset === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1)
  if (preset === 'quarter') {
    const quarterStartMonth = Math.floor(end.getMonth() / 3) * 3
    start = new Date(end.getFullYear(), quarterStartMonth, 1)
  }
  filters.from = dateToIso(start)
  filters.to = dateToIso(end)
}

/** Локальный календарный день из YYYY-MM-DD — как VisitsView (VaDateInput range ждёт `{ start, end }`, не кортеж). */
function parseDateIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

const reportsDateRangeModel = computed(() => {
  const hasFrom = Boolean(filters.from)
  const hasTo = Boolean(filters.to)
  if (!hasFrom && !hasTo) return undefined
  return {
    start: hasFrom ? parseDateIso(filters.from) ?? undefined : undefined,
    end: hasTo ? parseDateIso(filters.to) ?? undefined : undefined,
  }
})

const clientCount = computed(() => overview.value?.clients.totalClients ?? 0)
const activeClients = computed(() => overview.value?.clients.activeClients ?? 0)
const activeClientsShare = computed(() => overview.value?.clients.activeClientsSharePct ?? 0)
const revenueMonth = computed(() => overview.value?.finance.paidAmount ?? 0)
const revenueTrend = computed(() => overview.value?.finance.trendPct ?? 0)
const failedPaymentsCount = computed(() => overview.value?.finance.failedCount ?? 0)
const failedPaymentsAmount = computed(() => overview.value?.finance.failedAmount ?? 0)
const refundAmount = computed(() => overview.value?.finance.refundAmount ?? 0)
const refundCount = computed(() => overview.value?.finance.refundCount ?? 0)
const installmentPaidAmount = computed(() => overview.value?.finance.installmentPaidAmount ?? 0)
const installmentPaidCount = computed(() => overview.value?.finance.installmentPaidCount ?? 0)
const visitSessionsCount = computed(() => overview.value?.activity.visitSessionsCount ?? 0)
const newClientsInPeriod = computed(() => overview.value?.activity.newClientsCount ?? 0)
const contractsCreatedInPeriod = computed(() => overview.value?.activity.contractsCreatedCount ?? 0)
const paidPaymentsCount = computed(() => overview.value?.finance.paidCount ?? 0)
const showFailedPayments = computed(() => failedPaymentsCount.value > 0)

function formatNumber(value: number) {
  return new Intl.NumberFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US').format(value)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
}

const periodAppliedLabel = computed(() => {
  const from = overview.value?.period?.from
  const to = overview.value?.period?.to
  const a = formatShortDate(from ?? null)
  const b = formatShortDate(to ?? null)
  if (!a || !b) return ''
  return t('reports.periodApplied', { from: a, to: b })
})

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

function dateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function scheduleLoadReports(delayMs = 280) {
  if (loadTimer) clearTimeout(loadTimer)
  loadTimer = setTimeout(() => {
    void loadReports()
  }, delayMs)
}

function applyPreset(preset: 'today' | '7d' | '30d' | 'month' | 'quarter') {
  applyPresetInner(preset)
  scheduleLoadReports(0)
  void syncReportsFiltersToUrl()
}

/** VaDateInput range: объект `{ start, end }` или массив — см. VisitsView. */
function applyReportsDateRange(value: unknown) {
  if (value == null || value === '' || value === false) {
    applyPresetInner('today')
    scheduleLoadReports()
    void syncReportsFiltersToUrl()
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    filters.from = a != null && a !== '' ? toIsoDate(a) : ''
    filters.to = b != null && b !== '' ? toIsoDate(b) : ''
    periodPreset.value = 'custom'
    scheduleLoadReports()
    void syncReportsFiltersToUrl()
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    filters.from = r.start != null && r.start !== '' ? toIsoDate(r.start) : ''
    filters.to = r.end != null && r.end !== '' ? toIsoDate(r.end) : ''
    periodPreset.value = 'custom'
    scheduleLoadReports()
    void syncReportsFiltersToUrl()
  }
}

async function loadReports() {
  loading.value = true
  loadError.value = null
  try {
    const { data } = await api.get<ReportsOverview>('/reports/overview', {
      params: filters,
    })
    overview.value = data
  } catch (e: unknown) {
    loadError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('reports.loadFailed'),
      byCode: {
        INVALID_DATE_FILTER: t('payments.invalidDateFilter'),
        INVALID_DATE_RANGE: t('payments.invalidDateRange'),
      },
    })
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  const rows: Array<[string, string]> = [
    [t('reports.metrics.revenuePeriod'), String(revenueMonth.value)],
    [t('reports.metrics.revenueTrend'), String(revenueTrend.value)],
    [t('reports.metrics.paidPaymentsCount'), String(paidPaymentsCount.value)],
    [t('reports.metrics.installmentPaidAmount'), String(installmentPaidAmount.value)],
    [t('reports.metrics.installmentPaidCount'), String(installmentPaidCount.value)],
    [t('reports.metrics.refundAmount'), String(refundAmount.value)],
    [t('reports.metrics.refundCount'), String(refundCount.value)],
    [t('reports.metrics.failedPaymentsAmount'), String(failedPaymentsAmount.value)],
    [t('reports.metrics.failedPaymentsCount'), String(failedPaymentsCount.value)],
    [t('reports.metrics.clientsTotal'), String(clientCount.value)],
    [t('reports.metrics.activeClients'), String(activeClients.value)],
    [t('reports.metrics.activeClientsShare'), String(activeClientsShare.value)],
    [t('reports.metrics.visitSessionsInPeriod'), String(visitSessionsCount.value)],
    [t('reports.metrics.newClientsInPeriod'), String(newClientsInPeriod.value)],
    [t('reports.metrics.contractsCreatedInPeriod'), String(contractsCreatedInPeriod.value)],
  ]
  const csv = ['metric,value', ...rows.map((r) => `"${r[0].replaceAll('"', '""')}","${r[1]}"`)].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
  notify({ color: 'success', message: t('reports.exported') })
}

onMounted(() => {
  const parsed = parseReportsRouteQuery(route.query)
  applyRouteQuery(parsed)
  void syncReportsFiltersToUrl()
})

watch(
  () => route.query,
  () => {
    if (ignoreNextRouteQueryWatch) return
    const parsed = parseReportsRouteQuery(route.query)
    if (reportsStateMatchesParsed(parsed)) return
    applyRouteQuery(parsed)
    void syncReportsFiltersToUrl()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (loadTimer) clearTimeout(loadTimer)
})
</script>

<template>
  <div class="reports-page">
    <AppPageCard :title="t('reports.title')">
      <p class="reports-intro">{{ t('reports.pageIntro') }}</p>
      <p v-if="periodAppliedLabel" class="reports-period-applied">{{ periodAppliedLabel }}</p>
      <div class="reports-filters">
        <div class="preset-row">
          <VaButton size="small" :preset="periodPreset === 'today' ? 'primary' : 'secondary'" @click="applyPreset('today')">
            {{ t('reports.presets.today') }}
          </VaButton>
          <VaButton size="small" :preset="periodPreset === '7d' ? 'primary' : 'secondary'" @click="applyPreset('7d')">
            {{ t('reports.presets.7d') }}
          </VaButton>
          <VaButton size="small" :preset="periodPreset === '30d' ? 'primary' : 'secondary'" @click="applyPreset('30d')">
            {{ t('reports.presets.30d') }}
          </VaButton>
          <VaButton size="small" :preset="periodPreset === 'month' ? 'primary' : 'secondary'" @click="applyPreset('month')">
            {{ t('reports.presets.month') }}
          </VaButton>
          <VaButton size="small" :preset="periodPreset === 'quarter' ? 'primary' : 'secondary'" @click="applyPreset('quarter')">
            {{ t('reports.presets.quarter') }}
          </VaButton>
        </div>
        <VaDateInput
          mode="range"
          clearable
          :model-value="reportsDateRangeModel"
          :label="t('reports.periodRange')"
          @update:model-value="applyReportsDateRange($event)"
        />
      </div>
      <div class="reports-actions">
        <VaButton size="small" icon="refresh" :loading="loading" @click="loadReports">
          {{ t('common.refresh') }}
        </VaButton>
        <VaButton size="small" preset="secondary" icon="download" @click="exportCsv">
          {{ t('reports.exportCsv') }}
        </VaButton>
      </div>

      <VaAlert v-if="loadError" color="danger" outline class="reports-error">
        {{ loadError }}
      </VaAlert>

      <div class="reports-grid">
        <AppSectionCard :title="t('reports.blocks.salesTitle')" :subtitle="t('reports.blocks.salesSubtitle')">
          <p class="reports-block-hint">{{ t('reports.blocks.salesHint') }}</p>
          <div class="metric-row">
            <span>{{ t('reports.metrics.revenuePeriod') }}</span>
            <strong>{{ formatMoney(revenueMonth) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.revenueTrend') }}</span>
            <strong :class="{ down: revenueTrend < 0 }">{{ revenueTrend >= 0 ? '+' : '' }}{{ revenueTrend }}%</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.paidPaymentsCount') }}</span>
            <strong>{{ formatNumber(paidPaymentsCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.installmentPaidAmount') }}</span>
            <strong>{{ formatMoney(installmentPaidAmount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.installmentPaidCount') }}</span>
            <strong>{{ formatNumber(installmentPaidCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.refundAmount') }}</span>
            <strong>{{ formatMoney(refundAmount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.refundCount') }}</span>
            <strong>{{ formatNumber(refundCount) }}</strong>
          </div>
          <template v-if="showFailedPayments">
            <div class="metric-row metric-row--warn">
              <span>{{ t('reports.metrics.failedPaymentsAmount') }}</span>
              <strong>{{ formatMoney(failedPaymentsAmount) }}</strong>
            </div>
            <div class="metric-row metric-row--warn">
              <span>{{ t('reports.metrics.failedPaymentsCount') }}</span>
              <strong>{{ formatNumber(failedPaymentsCount) }}</strong>
            </div>
          </template>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.clientsTitle')" :subtitle="t('reports.blocks.clientsSubtitle')">
          <p class="reports-block-hint">{{ t('reports.blocks.clientsHint') }}</p>
          <div class="metric-row">
            <span>{{ t('reports.metrics.clientsTotal') }}</span>
            <strong>{{ formatNumber(clientCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.activeClients') }}</span>
            <strong>{{ formatNumber(activeClients) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.activeClientsShare') }}</span>
            <strong>{{ activeClientsShare }}%</strong>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.activityTitle')" :subtitle="t('reports.blocks.activitySubtitle')">
          <p class="reports-block-hint">{{ t('reports.blocks.activityHint') }}</p>
          <div class="metric-row">
            <span>{{ t('reports.metrics.visitSessionsInPeriod') }}</span>
            <strong>{{ formatNumber(visitSessionsCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.newClientsInPeriod') }}</span>
            <strong>{{ formatNumber(newClientsInPeriod) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.contractsCreatedInPeriod') }}</span>
            <strong>{{ formatNumber(contractsCreatedInPeriod) }}</strong>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.quickTitle')" :subtitle="t('reports.blocks.quickSubtitle')">
          <p class="reports-block-hint">{{ t('reports.blocks.quickHint') }}</p>
          <div class="quick-links">
            <RouterLink class="quick-link" to="/payments">{{ t('app.payments') }}</RouterLink>
            <RouterLink class="quick-link" to="/contracts">{{ t('app.contracts') }}</RouterLink>
            <RouterLink class="quick-link" to="/clients">{{ t('app.clients') }}</RouterLink>
            <RouterLink class="quick-link" to="/visits">{{ t('app.visits') }}</RouterLink>
          </div>
        </AppSectionCard>
      </div>
    </AppPageCard>
  </div>
</template>

<style scoped>
.reports-page { display: flex; flex-direction: column; gap: var(--app-page-gap); }
.reports-intro {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--app-muted);
  max-width: 52rem;
}
.reports-period-applied {
  margin: 0 0 var(--app-section-gap);
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--app-text);
}
.reports-block-hint {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--app-muted);
}
.reports-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-section-gap); margin-bottom: var(--app-section-gap); }
.preset-row { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.reports-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: var(--app-section-gap); }
.reports-error { margin-bottom: var(--app-section-gap); }
.reports-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-page-gap); }
.metric-row { display: flex; justify-content: space-between; align-items: center; gap: var(--app-section-gap); padding: 0.4rem 0; border-bottom: 1px solid var(--app-border); }
.metric-row:last-child { border-bottom: 0; }
.metric-row strong { color: var(--app-text); }
.metric-row strong.down { color: #dc2626; }
.metric-row--warn strong {
  color: #b45309;
}
.quick-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-section-gap); }
.quick-link { display: flex; align-items: center; justify-content: center; border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); min-height: var(--app-action-height); padding: 0.5rem 0.75rem; color: var(--app-text); text-decoration: none; font-weight: 600; transition: background-color 0.18s ease, color 0.18s ease; }
.quick-link:hover { background: var(--app-sidebar-hover); color: var(--app-accent-strong); }
@media (max-width: 900px) {
  .reports-filters { grid-template-columns: 1fr; }
  .reports-grid { grid-template-columns: 1fr; }
}
</style>
