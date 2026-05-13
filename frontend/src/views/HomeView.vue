<script setup lang="ts">
import type { ApexOptions } from 'apexcharts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import VueApexCharts from 'vue3-apexcharts'
import { RouterLink } from 'vue-router'
import { api } from '@/utils/api'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'

type SummaryResponse = {
  kpis: {
    clients: { value: number }
    activeClients: { value: number; sharePct: number }
    revenueMonth: { value: number; trendPct: number }
    activity30d: {
      visitSessions: number
      newClients: number
      contractsCreated: number
    }
  }
}

type ChartsResponse = {
  revenueByDay: { day: string; value: number }[]
  visitsByDay: { day: string; value: number }[]
  newClientsByDay: { day: string; value: number }[]
  contractsByDay: { day: string; value: number }[]
  membershipsByStatus: { status: string; value: number }[]
}

type AlertsResponse = {
  expiringMemberships: {
    id: string
    clientName: string
    phone: string | null
    endDate: string
  }[]
  failedPayments: {
    id: string
    amount: number
    paidAt: string
  }[]
}

const { t, locale } = useI18n()

const loading = ref(true)
const loadError = ref<string | null>(null)
const summary = ref<SummaryResponse | null>(null)
const charts = ref<ChartsResponse | null>(null)
const alerts = ref<AlertsResponse | null>(null)
const sectionErrors = ref<{ summary: string | null; charts: string | null; alerts: string | null }>({
  summary: null,
  charts: null,
  alerts: null,
})

/** Цвета из темы для Apex (CSS vars не всегда парсятся в canvas). */
const chartAccent = ref('#2563eb')
const chartAccent2 = ref('#0ea5e9')
const chartAccent3 = ref('#7c3aed')
const chartText = ref('#64748b')
const chartGrid = ref('rgba(100,116,139,0.2)')
const chartTooltipTheme = ref<'light' | 'dark'>('light')

/** Узкая ширина: компактные KPI и оси графиков без налезания подписей. */
const MOBILE_DASHBOARD_MQ = '(max-width: 640px)'
const isMobileDashboard = ref(false)
let mobileDashMq: MediaQueryList | null = null
let mobileDashListener: ((e: MediaQueryListEvent) => void) | null = null

const chartAreaHeight = computed(() => (isMobileDashboard.value ? 210 : 280))
const chartBarHeight = computed(() => (isMobileDashboard.value ? 240 : 300))

const summaryData = computed<SummaryResponse>(() =>
  summary.value ?? {
    kpis: {
      clients: { value: 0 },
      activeClients: { value: 0, sharePct: 0 },
      revenueMonth: { value: 0, trendPct: 0 },
      activity30d: { visitSessions: 0, newClients: 0, contractsCreated: 0 },
    },
  },
)

const chartsData = computed<ChartsResponse>(() =>
  charts.value ?? {
    revenueByDay: [],
    visitsByDay: [],
    newClientsByDay: [],
    contractsByDay: [],
    membershipsByStatus: [],
  },
)

const alertsData = computed<AlertsResponse>(() =>
  alerts.value ?? {
    expiringMemberships: [],
    failedPayments: [],
  },
)

const hasAnyData = computed(() => summary.value != null || charts.value != null || alerts.value != null)
const hasPartialErrors = computed(
  () =>
    Boolean(sectionErrors.value.summary) ||
    Boolean(sectionErrors.value.charts) ||
    Boolean(sectionErrors.value.alerts),
)

type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }

function settle<T>(promise: Promise<T>): Promise<SettledResult<T>> {
  return promise
    .then((value) => ({ status: 'fulfilled' as const, value }))
    .catch((reason) => ({ status: 'rejected' as const, reason }))
}

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

function formatDateTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatDay(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d)
}

/** Короткая метка даты на оси X для мобильных (меньше текста в одной метке). */
function formatDayCompact(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'numeric',
  }).format(d)
}

/** Разреживаем подписи категорий: первая и последняя дата всегда, между ними — с шагом. */
function buildSparseCategoryLabels(categories: string[], compactLabel: boolean): string[] {
  if (!compactLabel || categories.length <= 8) return categories
  const len = categories.length
  const maxTicks = 6
  const step = Math.max(1, Math.ceil(len / maxTicks))
  return categories.map((raw, i) => {
    if (i === 0 || i === len - 1) return raw
    return i % step === 0 ? raw : ''
  })
}

const chartCategories = computed(() =>
  chartsData.value.revenueByDay.length > 0
    ? chartsData.value.revenueByDay.map((x) => formatDay(x.day))
    : chartsData.value.visitsByDay.map((x) => formatDay(x.day)),
)

const chartCategoriesAxis = computed(() => {
  const src =
    chartsData.value.revenueByDay.length > 0
      ? chartsData.value.revenueByDay.map((x) => x.day)
      : chartsData.value.visitsByDay.map((x) => x.day)
  const labels = src.map((day) =>
    isMobileDashboard.value ? formatDayCompact(day) : formatDay(day),
  )
  return buildSparseCategoryLabels(labels, isMobileDashboard.value)
})

const revenueSeries = computed(() => [
  {
    name: t('home.charts.revenueSeries'),
    data: chartsData.value.revenueByDay.map((d) => d.value),
  },
])

const visitsSeries = computed(() => [
  {
    name: t('home.charts.visitsSeries'),
    data: chartsData.value.visitsByDay.map((d) => d.value),
  },
])

const activitySeries = computed(() => [
  {
    name: t('home.charts.newClientsSeries'),
    data: chartsData.value.newClientsByDay.map((d) => d.value),
  },
  {
    name: t('home.charts.contractsSeries'),
    data: chartsData.value.contractsByDay.map((d) => d.value),
  },
])

const baseAreaOptions = computed<ApexOptions>(() => {
  const mobile = isMobileDashboard.value
  const manyTicks = chartCategories.value.length > 14
  const axisFs = mobile ? '9px' : '11px'
  const strokeW = mobile ? 2 : 2.5
  return {
    chart: {
      fontFamily: 'inherit',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { speed: 280 },
    },
    colors: [chartAccent.value],
    grid: {
      borderColor: chartGrid.value,
      strokeDashArray: 4,
      padding: mobile
        ? { left: 0, right: 4, top: 4, bottom: 4 }
        : { left: 4, right: 8, top: 8, bottom: 2 },
    },
    dataLabels: { enabled: false },
    stroke: { width: strokeW, curve: 'smooth' },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: mobile ? 0.32 : 0.38,
        opacityTo: 0.04,
      },
    },
    xaxis: {
      categories: chartCategoriesAxis.value,
      labels: {
        rotate: mobile ? 0 : manyTicks ? -45 : 0,
        rotateAlways: false,
        hideOverlappingLabels: true,
        trim: true,
        style: { colors: chartText.value, fontSize: axisFs },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: chartText.value, fontSize: axisFs },
        formatter: (v: number) => formatNumber(Math.round(v)),
        maxWidth: mobile ? 52 : undefined,
      },
    },
    tooltip: {
      theme: chartTooltipTheme.value,
    },
    markers: {
      size: 0,
      hover: { size: mobile ? 4 : 5 },
    },
  }
})

const revenueChartOptions = computed<ApexOptions>(() => ({
  ...baseAreaOptions.value,
  colors: [chartAccent.value],
  yaxis: {
    labels: {
      style: {
        colors: chartText.value,
        fontSize: isMobileDashboard.value ? '9px' : '11px',
      },
      formatter: (v: number) => formatMoney(v),
      maxWidth: isMobileDashboard.value ? 56 : undefined,
    },
  },
  tooltip: {
    theme: chartTooltipTheme.value,
    y: {
      formatter: (v: number) => formatMoney(v),
    },
  },
}))

const visitsChartOptions = computed<ApexOptions>(() => ({
  ...baseAreaOptions.value,
  colors: [chartAccent2.value],
}))

const activityChartOptions = computed<ApexOptions>(() => {
  const mobile = isMobileDashboard.value
  const manyTicks = chartCategories.value.length > 14
  const axisFs = mobile ? '9px' : '11px'
  return {
    chart: {
      fontFamily: 'inherit',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { speed: 280 },
    },
    colors: [chartAccent2.value, chartAccent3.value],
    plotOptions: {
      bar: {
        borderRadius: mobile ? 3 : 4,
        columnWidth: mobile ? '78%' : '72%',
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    grid: {
      borderColor: chartGrid.value,
      strokeDashArray: 4,
      padding: mobile
        ? { left: 0, right: 4, top: 4, bottom: 4 }
        : { left: 4, right: 8, top: 8, bottom: 2 },
    },
    xaxis: {
      categories: chartCategoriesAxis.value,
      labels: {
        rotate: mobile ? 0 : manyTicks ? -45 : 0,
        hideOverlappingLabels: true,
        trim: true,
        style: { colors: chartText.value, fontSize: axisFs },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: chartText.value, fontSize: axisFs },
        formatter: (v: number) => formatNumber(Math.round(v)),
        maxWidth: mobile ? 48 : undefined,
      },
      min: 0,
    },
    legend: {
      position: mobile ? 'bottom' : 'top',
      horizontalAlign: mobile ? 'center' : 'right',
      fontSize: mobile ? '10px' : '12px',
      offsetY: mobile ? 0 : undefined,
      itemMargin: { horizontal: mobile ? 10 : 14, vertical: mobile ? 4 : 6 },
      labels: { colors: chartText.value },
    },
    tooltip: {
      theme: chartTooltipTheme.value,
    },
  }
})

const statusTotal = computed(() =>
  chartsData.value.membershipsByStatus.reduce((acc, item) => acc + item.value, 0),
)

const donutBackground = computed(() => {
  const data = chartsData.value.membershipsByStatus
  const total = statusTotal.value
  if (total === 0) return 'conic-gradient(#d7dee3 0 100%)'
  const colors: Record<string, string> = {
    ACTIVE: '#16a34a',
    EXPIRED: '#f59e0b',
    CANCELLED: '#ef4444',
    PENDING: '#64748b',
  }
  let from = 0
  const parts: string[] = []
  for (const item of data) {
    const share = (item.value / total) * 100
    const to = from + share
    parts.push(`${colors[item.status] ?? '#3b82f6'} ${from}% ${to}%`)
    from = to
  }
  return `conic-gradient(${parts.join(', ')})`
})

function syncChartThemeFromDom() {
  const root = document.documentElement
  const primary = getComputedStyle(root).getPropertyValue('--va-primary').trim()
  if (primary && /^#/.test(primary)) {
    chartAccent.value = primary
  }
  const isDark = root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
  chartTooltipTheme.value = isDark ? 'dark' : 'light'
  chartText.value = getComputedStyle(root).getPropertyValue('--app-muted').trim() || '#64748b'
  chartGrid.value = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.2)'
  chartAccent2.value = isDark ? '#38bdf8' : '#0ea5e9'
  chartAccent3.value = isDark ? '#a78bfa' : '#7c3aed'
}

async function loadDashboard() {
  loading.value = true
  loadError.value = null
  sectionErrors.value = { summary: null, charts: null, alerts: null }
  const [summaryRes, chartsRes, alertsRes] = await Promise.all([
    settle<SummaryResponse>(api.get<SummaryResponse>('/dashboard/summary').then((res) => res.data)),
    settle<ChartsResponse>(api.get<ChartsResponse>('/dashboard/charts').then((res) => res.data)),
    settle<AlertsResponse>(api.get<AlertsResponse>('/dashboard/alerts').then((res) => res.data)),
  ])

  if (summaryRes.status === 'fulfilled') {
    summary.value = summaryRes.value
  } else {
    summary.value = null
    sectionErrors.value.summary = t('home.sectionLoadFailed')
  }

  if (chartsRes.status === 'fulfilled') {
    charts.value = chartsRes.value
  } else {
    charts.value = null
    sectionErrors.value.charts = t('home.sectionLoadFailed')
  }

  if (alertsRes.status === 'fulfilled') {
    alerts.value = alertsRes.value
  } else {
    alerts.value = null
    sectionErrors.value.alerts = t('home.sectionLoadFailed')
  }

  if (!summary.value && !charts.value && !alerts.value) {
    loadError.value = t('home.loadFailed')
  }
  loading.value = false
}

onMounted(() => {
  syncChartThemeFromDom()
  mobileDashMq = window.matchMedia(MOBILE_DASHBOARD_MQ)
  isMobileDashboard.value = mobileDashMq.matches
  mobileDashListener = (e: MediaQueryListEvent) => {
    isMobileDashboard.value = e.matches
  }
  mobileDashMq.addEventListener('change', mobileDashListener)
  void loadDashboard()
})

onBeforeUnmount(() => {
  if (mobileDashMq && mobileDashListener) {
    mobileDashMq.removeEventListener('change', mobileDashListener)
  }
})

watch(locale, () => {
  syncChartThemeFromDom()
})
</script>

<template>
  <div class="dashboard-page">
    <VaAlert v-if="loadError" color="danger" outline class="mb-2">
      {{ loadError }}
    </VaAlert>
    <VaAlert v-else-if="hasPartialErrors" color="warning" outline class="mb-2">
      {{ t('home.sectionLoadFailed') }}
    </VaAlert>

    <div class="dashboard-actions">
      <RouterLink class="reports-link" to="/reports">
        {{ t('home.openReports') }}
      </RouterLink>
      <VaButton size="small" icon="refresh" :loading="loading" @click="loadDashboard">
        {{ t('common.refresh') }}
      </VaButton>
    </div>

    <div v-if="loading" class="dashboard-grid dashboard-grid--kpis">
      <VaSkeleton
        v-for="i in 4"
        :key="`kpi-${i}`"
        animation="wave"
        variant="rounded"
        height="104px"
      />
    </div>

    <template v-else-if="hasAnyData">
      <div class="dashboard-grid dashboard-grid--kpis">
        <AppPageCard :title="t('home.kpi.clients')" class="kpi-card">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.clients.value) }}</div>
          <div class="kpi-meta">{{ t('home.kpi.totalClients') }}</div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.activeClients')" class="kpi-card">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.activeClients.value) }}</div>
          <div class="kpi-meta">{{ t('home.kpi.shareActive', { pct: summaryData.kpis.activeClients.sharePct }) }}</div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.revenueMonth')" class="kpi-card">
          <div class="kpi-value">{{ formatMoney(summaryData.kpis.revenueMonth.value) }}</div>
          <div
            class="kpi-trend"
            :class="{ 'kpi-trend--down': summaryData.kpis.revenueMonth.trendPct < 0 }"
          >
            {{ summaryData.kpis.revenueMonth.trendPct >= 0 ? '+' : ''
            }}{{ summaryData.kpis.revenueMonth.trendPct }}%
          </div>
          <div class="kpi-meta">{{ t('home.kpi.vsPrevMonth') }}</div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.activity30d')" class="kpi-card kpi-card--activity">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.activity30d.visitSessions) }}</div>
          <div class="kpi-meta">{{ t('home.kpi.visitsInGym') }}</div>
          <div class="activity-split">
            <span>{{ t('home.kpi.newClientsShort') }}: {{ formatNumber(summaryData.kpis.activity30d.newClients) }}</span>
            <span>{{ t('home.kpi.contractsShort') }}: {{ formatNumber(summaryData.kpis.activity30d.contractsCreated) }}</span>
          </div>
        </AppPageCard>
      </div>

      <div class="dashboard-grid dashboard-grid--charts-main">
        <AppSectionCard :title="t('home.charts.revenue30d')" :subtitle="t('home.charts.dailyTrend')">
          <div class="chart-shell">
            <VueApexCharts
              v-if="chartsData.revenueByDay.length > 0"
              type="area"
              :height="chartAreaHeight"
              :options="revenueChartOptions"
              :series="revenueSeries"
            />
            <div v-else class="chart-empty">{{ t('home.chartEmpty') }}</div>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('home.charts.visits30d')" :subtitle="t('home.charts.dailyTrend')">
          <div class="chart-shell">
            <VueApexCharts
              v-if="chartsData.visitsByDay.length > 0"
              type="area"
              :height="chartAreaHeight"
              :options="visitsChartOptions"
              :series="visitsSeries"
            />
            <div v-else class="chart-empty">{{ t('home.chartEmpty') }}</div>
          </div>
        </AppSectionCard>
      </div>

      <AppSectionCard :title="t('home.charts.registrations30d')" :subtitle="t('home.charts.registrationsSubtitle')">
        <div class="chart-shell chart-shell--wide">
          <VueApexCharts
            v-if="chartsData.newClientsByDay.length > 0"
            type="bar"
            :height="chartBarHeight"
            :options="activityChartOptions"
            :series="activitySeries"
          />
          <div v-else class="chart-empty">{{ t('home.chartEmpty') }}</div>
        </div>
      </AppSectionCard>

      <div class="dashboard-grid dashboard-grid--bottom">
        <AppSectionCard :title="t('home.charts.contractsByStatus')" :subtitle="t('home.charts.currentSnapshot')">
          <div class="donut-wrap">
            <div class="donut-chart" :style="{ background: donutBackground }">
              <div class="donut-center">{{ statusTotal }}</div>
            </div>
            <div class="legend-list">
              <div v-for="item in chartsData.membershipsByStatus" :key="item.status" class="legend-item">
                <span class="legend-label">{{ t(`home.status.${item.status}`) }}</span>
                <span class="legend-value">
                  {{ formatNumber(item.value) }}
                  ({{ statusTotal ? ((item.value / statusTotal) * 100).toFixed(1) : 0 }}%)
                </span>
              </div>
            </div>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('home.tables.alerts')" :subtitle="t('home.tables.needsAttention')">
          <div class="alerts-stack">
            <div class="alert-block">
              <div class="alert-block__title">{{ t('home.alerts.expiring') }}</div>
              <div v-if="alertsData.expiringMemberships.length === 0" class="empty-inline">{{ t('home.alerts.none') }}</div>
              <div v-for="item in alertsData.expiringMemberships" :key="item.id" class="alert-row">
                <span>{{ item.clientName }}</span>
                <span>{{ formatDateTime(item.endDate) }}</span>
              </div>
            </div>
            <div class="alert-block">
              <div class="alert-block__title">{{ t('home.alerts.failedPayments') }}</div>
              <div v-if="alertsData.failedPayments.length === 0" class="empty-inline">{{ t('home.alerts.none') }}</div>
              <div v-for="item in alertsData.failedPayments" :key="item.id" class="alert-row">
                <span>{{ formatMoney(item.amount) }}</span>
                <span>{{ formatDateTime(item.paidAt) }}</span>
              </div>
            </div>
          </div>
        </AppSectionCard>
      </div>
    </template>

    <AppEmptyState
      v-else
      icon="analytics"
      :title="t('home.emptyTitle')"
      :description="t('home.emptyDesc')"
    />
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: var(--app-page-gap);
  width: 100%;
  min-width: 0;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.reports-link {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--app-accent-strong);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--app-accent) 45%, transparent);
  padding-bottom: 1px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.reports-link:hover {
  color: var(--app-accent);
  border-bottom-color: var(--app-accent);
}

.dashboard-grid {
  display: grid;
  gap: var(--app-page-gap);
}

.dashboard-grid--kpis {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-grid--charts-main,
.dashboard-grid--bottom {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.kpi-card {
  min-height: 104px;
}

.kpi-value {
  margin-top: 0.1rem;
  font-size: 1.65rem;
  line-height: 1.15;
  font-weight: 700;
  color: var(--app-text);
  letter-spacing: -0.02em;
}

.kpi-meta {
  margin-top: 0.3rem;
  color: var(--app-muted);
  font-size: 0.84rem;
  line-height: 1.35;
}

.kpi-trend {
  margin-top: 0.35rem;
  font-size: 0.88rem;
  font-weight: 700;
  color: #16a34a;
}

.kpi-trend--down {
  color: #dc2626;
}

.activity-split {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin-top: 0.45rem;
  font-size: 0.8rem;
  color: var(--app-muted);
}

.chart-shell {
  min-height: 280px;
  border-radius: var(--app-radius-md);
  background: color-mix(in srgb, var(--app-accent) 5%, transparent);
  padding: 0.35rem 0.25rem 0;
}

.chart-shell--wide {
  min-height: 300px;
}

.chart-empty {
  display: grid;
  place-items: center;
  min-height: 260px;
  color: var(--app-muted);
  font-size: 0.88rem;
}

.donut-wrap {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 1rem;
  align-items: center;
}

.donut-chart {
  width: 110px;
  height: 110px;
  border-radius: 999px;
  display: grid;
  place-items: center;
}

.donut-center {
  width: 68px;
  height: 68px;
  border-radius: 999px;
  background: var(--app-surface);
  display: grid;
  place-items: center;
  color: var(--app-text);
  font-weight: 700;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.legend-item {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.legend-label {
  color: var(--app-muted);
}

.legend-value {
  color: var(--app-text);
  font-weight: 600;
}

.alerts-stack {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.alert-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.alert-block__title {
  font-size: 0.86rem;
  color: var(--app-muted);
  font-weight: 600;
}

.alert-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--app-border) 75%, transparent);
  font-size: 0.83rem;
  color: var(--app-text);
}

.empty-inline {
  color: var(--app-muted);
  font-size: 0.84rem;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

@media (max-width: 1100px) {
  .dashboard-grid--kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .dashboard-grid--charts-main,
  .dashboard-grid--bottom {
    grid-template-columns: 1fr;
  }

  .donut-wrap {
    grid-template-columns: 1fr;
    justify-items: center;
  }
}

@media (max-width: 640px) {
  .dashboard-grid--kpis {
    grid-template-columns: 1fr;
  }

  .kpi-value {
    font-size: 1.22rem;
    letter-spacing: -0.01em;
  }

  .kpi-meta {
    font-size: 0.75rem;
    margin-top: 0.2rem;
  }

  .kpi-trend {
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }

  .activity-split {
    font-size: 0.72rem;
    margin-top: 0.35rem;
    gap: 0.3rem 0.75rem;
  }

  .kpi-card {
    min-height: 0;
  }

  .dashboard-grid--kpis :deep(.page-card__title) {
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .chart-shell {
    min-height: 210px;
    padding: 0.2rem 0.05rem 0;
  }

  .chart-shell--wide {
    min-height: 240px;
  }

  .chart-empty {
    min-height: 200px;
    font-size: 0.8rem;
  }

  .reports-link {
    font-size: 0.8rem;
  }

  .dashboard-actions {
    gap: 0.45rem;
    justify-content: space-between;
    width: 100%;
  }

  .donut-chart {
    width: 96px;
    height: 96px;
  }

  .donut-center {
    width: 58px;
    height: 58px;
    font-size: 0.92rem;
  }

  .legend-label {
    font-size: 0.76rem;
  }

  .legend-value {
    font-size: 0.76rem;
    font-weight: 600;
  }

  .alert-block__title,
  .alert-row,
  .empty-inline {
    font-size: 0.78rem;
  }

  .dashboard-page :deep(.section-card) {
    padding: 0.7rem 0.75rem;
  }

  .dashboard-page :deep(.section-card__title) {
    font-size: 0.9rem;
    line-height: 1.25;
  }

  .dashboard-page :deep(.section-card__subtitle) {
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }
}
</style>
