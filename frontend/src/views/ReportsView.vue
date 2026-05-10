<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { api } from '@/utils/api'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'

type ReportsOverview = {
  period: { from: string | null; to: string | null }
  finance: {
    paidAmount: number
    paidCount: number
    trendPct: number
    failedAmount: number
    failedCount: number
  }
  clients: {
    totalClients: number
    activeMemberships: number
    activeMembershipSharePct: number
  }
  risks: {
    highLoadClasses: number
  }
}

const { t, locale } = useI18n()
const { init: notify } = useToast()
const loading = ref(false)
const loadError = ref<string | null>(null)
const overview = ref<ReportsOverview | null>(null)
const filters = reactive({
  from: '',
  to: '',
})
const periodPreset = ref<'7d' | '30d' | 'month' | 'quarter' | 'custom'>('30d')
const rangeValue = ref<[Date, Date] | undefined>(undefined)
let loadTimer: ReturnType<typeof setTimeout> | null = null

const clientCount = computed(() => overview.value?.clients.totalClients ?? 0)
const activeMemberships = computed(() => overview.value?.clients.activeMemberships ?? 0)
const activeShare = computed(() => overview.value?.clients.activeMembershipSharePct ?? 0)
const revenueMonth = computed(() => overview.value?.finance.paidAmount ?? 0)
const revenueTrend = computed(() => overview.value?.finance.trendPct ?? 0)
const failedPaymentsCount = computed(() => overview.value?.finance.failedCount ?? 0)
const failedPaymentsAmount = computed(() => overview.value?.finance.failedAmount ?? 0)
const highLoadClasses = computed(() => overview.value?.risks.highLoadClasses ?? 0)
const paidPaymentsCount = computed(() => overview.value?.finance.paidCount ?? 0)

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

function isoToDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function setRangeFromFilters() {
  const from = isoToDate(filters.from)
  const to = isoToDate(filters.to)
  rangeValue.value = from && to ? [from, to] : undefined
}

function scheduleLoadReports(delayMs = 280) {
  if (loadTimer) clearTimeout(loadTimer)
  loadTimer = setTimeout(() => {
    void loadReports()
  }, delayMs)
}

function applyPreset(preset: '7d' | '30d' | 'month' | 'quarter') {
  periodPreset.value = preset
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
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
  setRangeFromFilters()
  scheduleLoadReports(0)
}

function applyRange(value: unknown) {
  const arrayValue = Array.isArray(value) ? value : []
  const fromRaw = arrayValue[0]
  const toRaw = arrayValue[1]
  const normalizePart = (part: unknown): Date | null => {
    if (part instanceof Date && !Number.isNaN(part.getTime())) return part
    if (typeof part === 'string') {
      const parsed = new Date(part)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    return null
  }
  const fromDate = normalizePart(fromRaw)
  const toDate = normalizePart(toRaw)
  periodPreset.value = 'custom'
  filters.from = fromDate ? dateToIso(fromDate) : ''
  filters.to = toDate ? dateToIso(toDate) : ''
  rangeValue.value = fromDate && toDate ? [fromDate, toDate] : undefined
  scheduleLoadReports()
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
    [t('reports.metrics.revenueMonth'), String(revenueMonth.value)],
    [t('reports.metrics.revenueTrend'), String(revenueTrend.value)],
    [t('reports.metrics.paidPaymentsCount'), String(paidPaymentsCount.value)],
    [t('reports.metrics.failedPaymentsAmount'), String(failedPaymentsAmount.value)],
    [t('reports.metrics.failedPaymentsCount'), String(failedPaymentsCount.value)],
    [t('reports.metrics.clientsTotal'), String(clientCount.value)],
    [t('reports.metrics.membershipsActive'), String(activeMemberships.value)],
    [t('reports.metrics.membershipsShare'), String(activeShare.value)],
    [t('reports.metrics.highLoadClasses'), String(highLoadClasses.value)],
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
  applyPreset('30d')
})

onBeforeUnmount(() => {
  if (loadTimer) clearTimeout(loadTimer)
})
</script>

<template>
  <div class="reports-page">
    <AppPageCard :title="t('reports.title')">
      <div class="reports-filters">
        <div class="preset-row">
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
          :model-value="rangeValue"
          :label="t('reports.periodRange')"
          @update:model-value="applyRange($event)"
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
          <div class="metric-row">
            <span>{{ t('reports.metrics.revenueMonth') }}</span>
            <strong>{{ formatMoney(revenueMonth) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.revenueTrend') }}</span>
            <strong :class="{ down: revenueTrend < 0 }">{{ revenueTrend >= 0 ? '+' : '' }}{{ revenueTrend }}%</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.failedPaymentsAmount') }}</span>
            <strong>{{ formatMoney(failedPaymentsAmount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.paidPaymentsCount') }}</span>
            <strong>{{ formatNumber(paidPaymentsCount) }}</strong>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.clientsTitle')" :subtitle="t('reports.blocks.clientsSubtitle')">
          <div class="metric-row">
            <span>{{ t('reports.metrics.clientsTotal') }}</span>
            <strong>{{ formatNumber(clientCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.membershipsActive') }}</span>
            <strong>{{ formatNumber(activeMemberships) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.membershipsShare') }}</span>
            <strong>{{ activeShare }}%</strong>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.risksTitle')" :subtitle="t('reports.blocks.risksSubtitle')">
          <div class="metric-row">
            <span>{{ t('reports.metrics.failedPaymentsCount') }}</span>
            <strong>{{ formatNumber(failedPaymentsCount) }}</strong>
          </div>
          <div class="metric-row">
            <span>{{ t('reports.metrics.highLoadClasses') }}</span>
            <strong>{{ formatNumber(highLoadClasses) }}</strong>
          </div>
        </AppSectionCard>

        <AppSectionCard :title="t('reports.blocks.quickTitle')" :subtitle="t('reports.blocks.quickSubtitle')">
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
.reports-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-section-gap); margin-bottom: var(--app-section-gap); }
.preset-row { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.reports-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: var(--app-section-gap); }
.reports-error { margin-bottom: var(--app-section-gap); }
.reports-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-page-gap); }
.metric-row { display: flex; justify-content: space-between; align-items: center; gap: var(--app-section-gap); padding: 0.4rem 0; border-bottom: 1px solid var(--app-border); }
.metric-row:last-child { border-bottom: 0; }
.metric-row strong { color: var(--app-text); }
.metric-row strong.down { color: #dc2626; }
.quick-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-section-gap); }
.quick-link { display: flex; align-items: center; justify-content: center; border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); min-height: var(--app-action-height); padding: 0.5rem 0.75rem; color: var(--app-text); text-decoration: none; font-weight: 600; transition: background-color 0.18s ease, color 0.18s ease; }
.quick-link:hover { background: var(--app-sidebar-hover); color: var(--app-accent-strong); }
@media (max-width: 900px) {
  .reports-filters { grid-template-columns: 1fr; }
  .reports-grid { grid-template-columns: 1fr; }
}
</style>
