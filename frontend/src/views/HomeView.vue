<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'

type SummaryResponse = {
  kpis: {
    employees: { value: number; trendPct: number; metaValue: number }
    clients: { value: number }
    membershipsActive: { value: number; sharePct: number }
    revenueMonth: { value: number; trendPct: number }
  }
  roleDistribution: { role: string; value: number }[]
  recentEmployees: {
    id: string
    login: string
    fullName: string
    role: string
    createdAt: string
  }[]
  employeesByDay: { day: string; value: number }[]
}

type ChartsResponse = {
  revenueByDay: { day: string; value: number }[]
  attendanceByDay: { day: string; value: number }[]
  membershipsByStatus: { status: string; value: number }[]
  trainerLoad: {
    trainerId: string
    label: string
    classesCount: number
    clientsCount: number
  }[]
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
  upcomingClasses: {
    id: string
    name: string
    startTime: string
    trainer: string
    capacity: number
    booked: number
    occupancyPct: number
  }[]
}

const { t, locale } = useI18n()
const auth = useAuthStore()
const { user } = storeToRefs(auth)

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

const summaryData = computed<SummaryResponse>(() =>
  summary.value ?? {
    kpis: {
      employees: { value: 0, trendPct: 0, metaValue: 0 },
      clients: { value: 0 },
      membershipsActive: { value: 0, sharePct: 0 },
      revenueMonth: { value: 0, trendPct: 0 },
    },
    roleDistribution: [],
    recentEmployees: [],
    employeesByDay: [],
  },
)

const chartsData = computed<ChartsResponse>(() =>
  charts.value ?? {
    revenueByDay: [],
    attendanceByDay: [],
    membershipsByStatus: [],
    trainerLoad: [],
  },
)

const alertsData = computed<AlertsResponse>(() =>
  alerts.value ?? {
    expiringMemberships: [],
    failedPayments: [],
    upcomingClasses: [],
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
    day: '2-digit',
  }).format(d)
}

function sparklinePoints(items: { value: number }[]) {
  if (items.length === 0) return ''
  const width = 320
  const height = 80
  const max = Math.max(...items.map((i) => i.value), 1)
  const stepX = items.length > 1 ? width / (items.length - 1) : width
  return items
    .map((item, idx) => {
      const x = Math.round(idx * stepX)
      const y = Math.round(height - (item.value / max) * height)
      return `${x},${y}`
    })
    .join(' ')
}

const revenuePoints = computed(() => sparklinePoints(chartsData.value.revenueByDay))
const attendancePoints = computed(() => sparklinePoints(chartsData.value.attendanceByDay))
const employeePoints = computed(() => sparklinePoints(summaryData.value.employeesByDay))

const maxTrainerLoad = computed(() =>
  Math.max(
    1,
    ...chartsData.value.trainerLoad.map((item) => item.classesCount + item.clientsCount),
  ),
)

const roleTotal = computed(() =>
  summaryData.value.roleDistribution.reduce((acc, item) => acc + item.value, 0),
)

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

const dayTicks = computed(() => {
  const source = chartsData.value.revenueByDay
  if (source.length <= 3) return source.map((x) => x.day)
  return [source[0]?.day, source[Math.floor(source.length / 2)]?.day, source[source.length - 1]?.day].filter(
    (x): x is string => Boolean(x),
  )
})

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
  void loadDashboard()
})
</script>

<template>
  <div class="dashboard-page">
    <VaAlert v-if="user" color="primary" border="left" class="session-alert">
      {{ t('home.session', { account: user.email ?? user.login, role: user.role }) }}
    </VaAlert>

    <VaAlert v-if="loadError" color="danger" outline class="mb-2">
      {{ loadError }}
    </VaAlert>
    <VaAlert v-else-if="hasPartialErrors" color="warning" outline class="mb-2">
      {{ t('home.sectionLoadFailed') }}
    </VaAlert>

    <div class="dashboard-actions">
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
        height="96px"
      />
    </div>

    <template v-else-if="hasAnyData">
      <div class="dashboard-grid dashboard-grid--kpis">
        <AppPageCard :title="t('home.kpi.employees')">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.employees.value) }}</div>
          <div class="kpi-meta">
            {{ t('home.kpi.newIn30d', { value: formatNumber(summaryData.kpis.employees.metaValue) }) }}
          </div>
          <div class="kpi-trend" :class="{ 'kpi-trend--down': summaryData.kpis.employees.trendPct < 0 }">
            {{ summaryData.kpis.employees.trendPct >= 0 ? '+' : '' }}{{ summaryData.kpis.employees.trendPct }}%
          </div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.clients')">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.clients.value) }}</div>
          <div class="kpi-meta">{{ t('home.kpi.totalClients') }}</div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.membershipsActive')">
          <div class="kpi-value">{{ formatNumber(summaryData.kpis.membershipsActive.value) }}</div>
          <div class="kpi-meta">{{ t('home.kpi.shareActive', { pct: summaryData.kpis.membershipsActive.sharePct }) }}</div>
        </AppPageCard>

        <AppPageCard :title="t('home.kpi.revenueMonth')">
          <div class="kpi-value">{{ formatMoney(summaryData.kpis.revenueMonth.value) }}</div>
          <div class="kpi-trend" :class="{ 'kpi-trend--down': summaryData.kpis.revenueMonth.trendPct < 0 }">
            {{ summaryData.kpis.revenueMonth.trendPct >= 0 ? '+' : '' }}{{ summaryData.kpis.revenueMonth.trendPct }}%
          </div>
        </AppPageCard>
      </div>

      <div class="dashboard-grid dashboard-grid--charts">
        <AppSectionCard :title="t('home.charts.revenue30d')" :subtitle="t('home.charts.daily')">
          <div class="chart-wrap">
            <svg viewBox="0 0 320 80" class="sparkline" preserveAspectRatio="none">
              <polyline :points="revenuePoints" fill="none" stroke="var(--app-accent)" stroke-width="3" />
            </svg>
            <div class="chart-axis">
              <span v-for="tick in dayTicks" :key="`rev-${tick}`">{{ formatDay(tick) }}</span>
            </div>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('home.charts.attendance30d')" :subtitle="t('home.charts.daily')">
          <div class="chart-wrap">
            <svg viewBox="0 0 320 80" class="sparkline" preserveAspectRatio="none">
              <polyline
                :points="attendancePoints"
                fill="none"
                stroke="color-mix(in srgb, var(--app-accent) 70%, #0ea5e9)"
                stroke-width="3"
              />
            </svg>
            <div class="chart-axis">
              <span v-for="tick in dayTicks" :key="`att-${tick}`">{{ formatDay(tick) }}</span>
            </div>
          </div>
        </AppSectionCard>
      </div>

      <div class="dashboard-grid dashboard-grid--analytics">
        <AppSectionCard :title="t('home.charts.membershipStatus')" :subtitle="t('home.charts.currentSnapshot')">
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

        <AppSectionCard :title="t('home.charts.trainerLoad')" :subtitle="t('home.charts.top7')">
          <div class="bar-list">
            <div v-for="item in chartsData.trainerLoad" :key="item.trainerId" class="bar-item">
              <div class="bar-label">{{ item.label }}</div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ width: `${((item.classesCount + item.clientsCount) / maxTrainerLoad) * 100}%` }"
                />
              </div>
              <div class="bar-value">{{ item.classesCount }} / {{ item.clientsCount }}</div>
            </div>
          </div>
        </AppSectionCard>
      </div>

      <div class="dashboard-grid dashboard-grid--bottom">
        <AppSectionCard :title="t('home.tables.upcomingClasses')" :subtitle="t('home.tables.nextFive')">
          <div v-if="alertsData.upcomingClasses.length === 0" class="empty-inline">{{ t('home.emptyClasses') }}</div>
          <table v-else class="mini-table">
            <thead>
              <tr>
                <th>{{ t('home.tables.class') }}</th>
                <th>{{ t('home.tables.trainer') }}</th>
                <th>{{ t('home.tables.time') }}</th>
                <th>{{ t('home.tables.load') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in alertsData.upcomingClasses" :key="row.id">
                <td>{{ row.name }}</td>
                <td>{{ row.trainer }}</td>
                <td>{{ formatDateTime(row.startTime) }}</td>
                <td>{{ row.booked }}/{{ row.capacity }} ({{ row.occupancyPct }}%)</td>
              </tr>
            </tbody>
          </table>
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

      <div class="dashboard-grid dashboard-grid--mvp">
        <AppSectionCard :title="t('home.charts.employeesTrend30d')" :subtitle="t('home.charts.usersMvpSource')">
          <div class="chart-wrap">
            <svg viewBox="0 0 320 80" class="sparkline" preserveAspectRatio="none">
              <polyline :points="employeePoints" fill="none" stroke="#7c3aed" stroke-width="3" />
            </svg>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('home.tables.recentEmployees')" :subtitle="t('home.tables.lastFive')">
          <div v-if="summaryData.recentEmployees.length === 0" class="empty-inline">{{ t('home.emptyEmployees') }}</div>
          <table v-else class="mini-table">
            <thead>
              <tr>
                <th>{{ t('users.login') }}</th>
                <th>{{ t('users.fullName') }}</th>
                <th>{{ t('users.role') }}</th>
                <th>{{ t('users.createdAt') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in summaryData.recentEmployees" :key="row.id">
                <td>{{ row.login }}</td>
                <td>{{ row.fullName }}</td>
                <td>{{ t(`users.roles.${row.role}`) }}</td>
                <td>{{ formatDateTime(row.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </AppSectionCard>
      </div>

      <AppSectionCard :title="t('home.charts.roles')" :subtitle="t('home.charts.usersMvpSource')">
        <div class="bar-list">
          <div v-for="role in summaryData.roleDistribution" :key="role.role" class="bar-item">
            <div class="bar-label">{{ t(`users.roles.${role.role}`) }}</div>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{ width: `${roleTotal ? (role.value / roleTotal) * 100 : 0}%` }"
              />
            </div>
            <div class="bar-value">{{ role.value }}</div>
          </div>
        </div>
      </AppSectionCard>
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

.session-alert {
  font-size: 0.9rem;
  width: 100%;
  align-self: stretch;
}

.dashboard-actions {
  display: flex;
  justify-content: flex-end;
}

.dashboard-grid {
  display: grid;
  gap: var(--app-page-gap);
}

.dashboard-grid--kpis {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-grid--charts,
.dashboard-grid--analytics,
.dashboard-grid--bottom,
.dashboard-grid--mvp {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.kpi-value {
  margin-top: 0.1rem;
  font-size: 1.75rem;
  line-height: 1.15;
  font-weight: 700;
  color: var(--app-text);
}

.kpi-meta {
  margin-top: 0.25rem;
  color: var(--app-muted);
  font-size: 0.86rem;
}

.kpi-trend {
  margin-top: 0.4rem;
  font-size: 0.88rem;
  font-weight: 700;
  color: #16a34a;
}

.kpi-trend--down {
  color: #dc2626;
}

.chart-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sparkline {
  width: 100%;
  height: 92px;
  background: color-mix(in srgb, var(--app-accent) 6%, transparent);
  border-radius: var(--app-radius-md);
}

.chart-axis {
  display: flex;
  justify-content: space-between;
  color: var(--app-muted);
  font-size: 0.78rem;
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

.bar-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.bar-item {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  align-items: center;
  gap: 0.6rem;
}

.bar-label {
  font-size: 0.85rem;
  color: var(--app-text);
}

.bar-track {
  width: 100%;
  height: 8px;
  background: color-mix(in srgb, var(--app-border) 85%, transparent);
  border-radius: 999px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--app-accent);
  border-radius: 999px;
}

.bar-value {
  font-size: 0.82rem;
  color: var(--app-muted);
  min-width: 64px;
  text-align: right;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
}

.mini-table th,
.mini-table td {
  padding: 0.45rem 0.25rem;
  border-bottom: 1px solid var(--app-border);
  font-size: var(--app-table-body-size);
  text-align: left;
}

.mini-table th {
  color: var(--app-muted);
  font-weight: 600;
}

.mini-table td {
  color: var(--app-text);
}

.alerts-stack {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
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
  .dashboard-grid--charts,
  .dashboard-grid--analytics,
  .dashboard-grid--bottom,
  .dashboard-grid--mvp {
    grid-template-columns: 1fr;
  }

  .donut-wrap {
    grid-template-columns: 1fr;
    justify-items: center;
  }

  .bar-item {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }

  .bar-value {
    text-align: left;
  }
}
</style>
