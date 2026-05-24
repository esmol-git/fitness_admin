<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'vuestic-ui'
import {
  createClientsStatusFilterOptions,
  createClientsTableColumns,
  parseClientStatusFilterValue,
} from '@/config/clientsTable'
import { TableActionIcon } from '@/config/tableActionIcons'
import { DEFAULT_TABLE_PAGE_LIMIT } from '@/config/tablePagination'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppDateRangeFilter from '@/components/ui/AppDateRangeFilter.vue'
import ContractFreezeModal from '@/components/contracts/ContractFreezeModal.vue'
import ContractResumeModal from '@/components/contracts/ContractResumeModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppExportMenu from '@/components/ui/AppExportMenu.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import ClientFormFields from '@/components/clients/ClientFormFields.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { parseClientsListRouteQuery, useClientsListUrlSync, type ClientEditTab } from '@/composables/useClientsListUrlSync'
import { fetchActiveMembershipCatalogOptions } from '@/composables/membershipCatalogCache'
import { fetchManagerOptions } from '@/composables/managersCache'
import { useCrudForm } from '@/composables/useCrudForm'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useTableDataSource } from '@/composables/useTableDataSource'
import { useTableFilteringSync } from '@/composables/useTableFilteringSync'
import { useTableSortingSync } from '@/composables/useTableSortingSync'
import { useTableState } from '@/composables/useTableState'
import type { ClientForm, ClientRow, ClientStatus } from '@/types/clients'
import type { TableHeaderConfig, TableSortOrder } from '@/types/table'
import { api } from '@/utils/api'
import { clientPhotoDisplayUrl, clientPhotoUrlForApiPayload } from '@/utils/clientPhotoUrl'
import { buildClientsListApiParams } from '@/utils/clientsListApiParams'
import { getClientContractDaysLeft } from '@/utils/clientContractRemaining'
import { ExportTooManyRowsError, fetchAllPaginatedItems } from '@/utils/fetchAllPages'
import { formatExportPeriodCaption } from '@/utils/exportPeriodCaption'
import { downloadTableExport, type TableExportFormat } from '@/utils/tableExport'
import { meaningfulAlertText } from '@/utils/meaningfulAlertText'
import { sanitizeLockerDigits } from '@/utils/lockerNumber'
import { isoCalendarDateAtNowLocalTimeToUtcIso, pickerValueToIsoYmd } from '@/utils/ruDateInput'

const { t } = useI18n()
const { init: notify } = useToast()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const auth = useAuthStore()
const urlInit = parseClientsListRouteQuery(route.query)
const editClientId = ref(urlInit.editClientId)
const editClientTab = ref<ClientEditTab>(urlInit.editClientTab)

const table = useTableState<
  ClientRow,
  {
    status?: ClientStatus | ''
    inGym?: 'IN_GYM' | 'OUT_GYM' | 'VISIT_OVERDUE' | ''
    membershipType?: string
    lastVisitFrom?: string
    lastVisitTo?: string
    gender?: 'MALE' | 'FEMALE' | ''
    ageFrom?: string
    ageTo?: string
  }
>({
  initialLimit: urlInit.limit,
  initialPage: urlInit.page,
  initialSearch: urlInit.search,
  initialFilters: {
    status: urlInit.status,
    inGym: urlInit.inGym,
    membershipType: urlInit.membershipType,
    lastVisitFrom: urlInit.lastVisitFrom,
    lastVisitTo: urlInit.lastVisitTo,
    gender: urlInit.gender,
    ageFrom: urlInit.ageFrom,
    ageTo: urlInit.ageTo,
  },
  initialSortBy: urlInit.sortBy,
  initialSortOrder: urlInit.sortOrder ?? 'desc',
  searchDebounceMs: 450,
  initialLoading: true,
})

const {
  loading,
  search,
  page,
  limit,
  items,
  total,
  pages,
  query,
  filters,
  sortBy,
  sortOrder,
  hasActiveFilters,
  setResult,
  applySearchNow,
  syncSearchImmediate,
  patchFilters,
  setSort,
  resetFilters,
  debouncedSearch,
} = table

const statusFilterOptions = computed(() => createClientsStatusFilterOptions(t))
const ALL_STATUS_VALUE = '__ALL_STATUSES__'
const ALL_GYM_VALUE = '__ALL_GYM__'
const ALL_GENDER_VALUE = '__ALL_GENDERS__'
const ALL_MEMBERSHIP_VALUE = '__ALL_MEMBERSHIPS__'
const statusFilterSelectOptions = computed(() =>
  statusFilterOptions.value.map((option) => ({
    ...option,
    value: option.value === '' ? ALL_STATUS_VALUE : option.value,
  })),
)
const inGymFilterOptions = computed(() => [
  { value: ALL_GYM_VALUE, text: t('common.all') },
  { value: 'IN_GYM', text: t('clients.inGymYes') },
  { value: 'OUT_GYM', text: t('clients.inGymNo') },
])
const genderFilterOptions = computed(() => [
  { value: ALL_GENDER_VALUE, text: t('common.all') },
  { value: 'MALE', text: t('clients.gender.MALE') },
  { value: 'FEMALE', text: t('clients.gender.FEMALE') },
])
const membershipFilterOptions = computed(() => [
  { value: ALL_MEMBERSHIP_VALUE, text: t('common.all') },
  ...memberships.value,
])
const columns = computed<TableHeaderConfig[]>(() => createClientsTableColumns(t))
const managers = ref<{ value: string; text: string }[]>([])

/** Блокировка, разблокировка и удаление клиента недоступны менеджеру. */
const canBlockOrDeleteClient = computed(() => auth.user?.role !== 'MANAGER')
const memberships = ref<
  Array<{
    value: string
    text: string
    price: number | null
    durationValue: number | null
    durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
  }>
>([])

const createState = useCrudForm<ClientForm>(() => ({
  firstName: '',
  lastName: '',
  phone: '',
  middleName: '',
  birthDate: '',
  gender: '',
  status: 'INACTIVE',
  email: '',
  passport: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  address: '',
  notes: '',
  contractNumber: '',
  contractStartDate: '',
  contractEndDate: '',
  paymentDate: '',
  membershipType: '',
  cardNumber: '',
  lockerNumber: '',
  photoUrl: '',
}))

const editState = useCrudForm<ClientForm>(() => ({
  firstName: '',
  lastName: '',
  phone: '',
  middleName: '',
  birthDate: '',
  gender: '',
  status: 'INACTIVE',
  email: '',
  passport: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  address: '',
  notes: '',
  contractNumber: '',
  contractStartDate: '',
  contractEndDate: '',
  paymentDate: '',
  membershipType: '',
  cardNumber: '',
  lockerNumber: '',
  photoUrl: '',
}))
const editModalOpen = editState.open
const createModalOpen = createState.open
let editModalOpening = false
let editClientUrlOpenRequest = 0

const createModalErrorText = computed(() => meaningfulAlertText(createState.error.value))
const editModalErrorText = computed(() => meaningfulAlertText(editState.error.value))

const createAttempted = ref(false)
const editAttempted = ref(false)
const editingId = ref<string | null>(null)
const editHeaderSnapshot = ref<{
  headline: string
  status: ClientStatus
  inGym: boolean | null
  openVisitStatus: ClientRow['openVisitStatus']
}>({
  headline: '—',
  status: 'INACTIVE',
  inGym: null,
  openVisitStatus: null,
})
const editPauseUntil = ref<string | null>(null)
const editPauseDurationDays = ref<number | null>(null)
const createInitialSnapshot = ref('')
const editInitialSnapshot = ref('')
const deleteOpen = ref(false)
const deleteLoading = ref(false)
const deleteError = ref<string | null>(null)
const deletingClient = ref<ClientRow | null>(null)
const blockOpen = ref(false)
const blockTarget = ref<ClientRow | null>(null)
const unblockOpen = ref(false)
const unblockTarget = ref<ClientRow | null>(null)
const discardOpen = ref(false)
const discardTarget = ref<'create' | 'edit' | null>(null)
const generateConfirmOpen = ref(false)
type ClientEditorFormExpose = {
  focusFirstInvalid: () => void
  validateSubmitFields: () => void
  flushPendingPhotoUpload: () => Promise<boolean>
  resetPhotoDraft: () => void
}

const createFormRef = ref<ClientEditorFormExpose | null>(null)
const editFormRef = ref<ClientEditorFormExpose | null>(null)
const createPhotoDraftPending = ref(false)
const editPhotoDraftPending = ref(false)
const createCardChecking = ref(false)
const editCardChecking = ref(false)
const createCardTaken = ref(false)
const editCardTaken = ref(false)
const editLockerChecking = ref(false)
const editLockerTaken = ref(false)
const editContractsHistory = ref<
  Array<{
    id: string
    contractNumber: string
    status?: string
    servicePrice?: string | number | null
    serviceStartDate?: string | null
    serviceEndDate?: string | null
    contractDate?: string | null
    pauseUntil?: string | null
    pauseDurationDays?: number | null
    s3Url?: string | null
    createdAt: string
    paidTotal?: string
    balanceDue?: string | null
    fullyPaid?: boolean
    paymentPlan?: string
    installmentCount?: number | null
    suggestedEqualPayment?: string | null
    serviceName?: string | null
  }>
>([])
const editContractsLoading = ref(false)
const editPaymentsHistory = ref<
  Array<{
    id: string
    amount: string | number
    paidAt: string
    status: string
    channel?: 'CASH' | 'NON_CASH' | string | null
    comment?: string | null
    contractDocumentId?: string | null
    operationType?: string
    contract?: { id: string; contractNumber: string; s3Url?: string | null } | null
  }>
>([])
const editVisitsHistory = ref<
  Array<{
    id: string
    lockerNumber: string
    enteredAt: string
    exitedAt: string | null
    status: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED'
    closeReason?: string | null
    comment?: string | null
    exitedBy?: { firstName?: string | null; lastName?: string | null; login?: string } | null
  }>
>([])
const editVisitsLoading = ref(false)
const editVisitsPage = ref(1)
const editVisitsLimit = ref<number>(DEFAULT_TABLE_PAGE_LIMIT)
const editVisitsTotal = ref(0)
const editVisitsFrom = ref('')
const editVisitsTo = ref('')
const editVisitsRequestId = ref(0)
const editPaymentsLoading = ref(false)
/** В селекте «тип абонемента» показываем неактивный каталог, если он уже выбран у клиента. */
const editMembershipExtraOption = ref<{ value: string; text: string } | null>(null)
const addContractPaymentLoading = ref(false)
const editHistoryRequestId = ref(0)
const clientsRowMenuOpenId = ref<string | null>(null)
const clientsRowMenuRow = ref<ClientRow | null>(null)
const clientsRowMenuAnchorRect = ref<DOMRect | null>(null)
const activateOpen = ref(false)
const activateTargetId = ref<string | null>(null)
const activateLoading = ref(false)
const activateUiError = ref<string | null>(null)
const activateForm = ref({ serviceStartDate: '', serviceEndDate: '' })
const activateDuration = ref<{
  durationValue: number | null
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
} | null>(null)

const freezeOpen = ref(false)
const freezeLoading = ref(false)
const freezeTargetId = ref<string | null>(null)
const freezeUiError = ref<string | null>(null)
const resumeOpen = ref(false)
const resumeLoading = ref(false)
const resumeTargetId = ref<string | null>(null)
const resumeUiError = ref<string | null>(null)
const cancelOpen = ref(false)
const cancelLoading = ref(false)
const cancelTarget = ref<{ id: string; contractNumber: string } | null>(null)
const cancelForm = ref({ refundAmount: '', refundMethod: 'CASH', comment: '' })
const statusActionLoadingId = ref<string | null>(null)
const contractGenerateLoadingId = ref<string | null>(null)
let createCardTimer: ReturnType<typeof setTimeout> | null = null
let editCardTimer: ReturnType<typeof setTimeout> | null = null
let editLockerTimer: ReturnType<typeof setTimeout> | null = null

const { onTableSortBy, onTableSortOrder, resetSort } = useTableSortingSync({
  sortBy,
  sortOrder,
  setSort,
  defaultSort: 'lastVisitAt:desc',
})

const { createStringFilterHandler, resetAllFilters: resetTableFilters } = useTableFilteringSync({
  patchFilters,
  resetFilters,
  onAfterReset: resetSort,
})

const sortDeviates = computed(() => sortBy.value !== 'lastVisitAt' || sortOrder.value !== 'desc')
const hasToolbarReset = computed(
  () => hasActiveFilters.value || search.value.trim().length > 0 || sortDeviates.value,
)

function getDisplayFullName(form: ClientForm) {
  return [form.lastName, form.firstName, form.middleName].map((v) => v.trim()).filter(Boolean).join(' ')
}

function getAgeValue(isoDate: string) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const birth = new Date(year, month - 1, day)
  if (Number.isNaN(birth.getTime())) return null
  let age = new Date().getFullYear() - birth.getFullYear()
  const today = new Date()
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age >= 0 ? age : null
}

function formatAgeRu(age: number | null) {
  if (age == null) return ''
  const mod10 = age % 10
  const mod100 = age % 100
  let suffix = 'лет'
  if (mod10 === 1 && mod100 !== 11) suffix = 'год'
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) suffix = 'года'
  return `${age} ${suffix}`
}

function getPersonHeadline(form: ClientForm) {
  const fio = getDisplayFullName(form) || '—'
  const age = formatAgeRu(getAgeValue(form.birthDate))
  return age ? `${fio}, ${age}` : fio
}

function resolveClientGymHeaderState(
  client: Pick<ClientRow, 'inGym' | 'openVisitStatus'>,
): { inGym: boolean | null; openVisitStatus: ClientRow['openVisitStatus'] } {
  const openVisitStatus = client.openVisitStatus ?? null
  if (openVisitStatus != null) {
    return { inGym: true, openVisitStatus }
  }
  if (typeof client.inGym === 'boolean') {
    return { inGym: client.inGym, openVisitStatus: null }
  }
  return { inGym: null, openVisitStatus: null }
}

function clientGymTableChip(row: Pick<ClientRow, 'inGym' | 'openVisitStatus'>) {
  if (row.inGym === true || row.openVisitStatus != null) {
    return {
      label: t('clients.inGymYes'),
      tone: 'success' as const,
      title: t('clients.openScannerFromGymChip'),
    }
  }
  return {
    label: t('clients.inGymNo'),
    tone: 'neutral' as const,
    title: t('clients.openScannerFromGymChip'),
  }
}

const createPersonHeadline = computed(() => getPersonHeadline(createState.form.value))
const createHeaderStatus = computed(() => createState.form.value.status)
const editClientBlocked = computed(
  () => editHeaderSnapshot.value.status === 'BLOCKED' || editState.form.value.status === 'BLOCKED',
)

useClientsListUrlSync(route, router, {
  debouncedSearch,
  filters,
  page,
  limit,
  sortBy,
  sortOrder,
  syncSearchImmediate,
  editClientId,
  editClientTab,
})

const onStatusFilter = createStringFilterHandler('status', (value) =>
  parseClientStatusFilterValue(value === ALL_STATUS_VALUE ? '' : value),
)
const onInGymFilter = createStringFilterHandler('inGym', (value) =>
  value === ALL_GYM_VALUE
    ? ''
    : value === 'IN_GYM' || value === 'OUT_GYM' || value === 'VISIT_OVERDUE' || value === ''
      ? value
      : null,
)
const onMembershipFilter = createStringFilterHandler('membershipType', (value) =>
  value === ALL_MEMBERSHIP_VALUE ? '' : value,
)
const onGenderFilter = createStringFilterHandler('gender', (value) =>
  value === ALL_GENDER_VALUE ? '' : value === 'MALE' || value === 'FEMALE' || value === '' ? value : null,
)

function resetToolbar() {
  search.value = ''
  applySearchNow()
  resetTableFilters()
}

function handleSortByUpdate(value: unknown) {
  onTableSortBy(typeof value === 'string' ? value : null)
}

function handleSortOrderUpdate(value: unknown) {
  if (value === 'asc' || value === 'desc' || value == null) {
    onTableSortOrder((value ?? null) as TableSortOrder)
  }
}

const exportLoading = ref(false)

const clientsSource = useTableDataSource<ClientRow, typeof query.value>({
  query,
  loading,
  setResult,
  fetcher: async (params) => {
    const safeParams = buildClientsListApiParams(params)
    const { data } = await api.get('/clients', { params: safeParams })
    return { items: data.items as ClientRow[], total: data.total as number }
  },
  mapError: (e) =>
    resolveApiErrorMessage(e, {
      defaultMessage: t('clients.loadFailed'),
      byStatus: { 403: t('clients.forbidden') },
    }),
})

function formatExportDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU')
}

function clientExportFullName(row: ClientRow) {
  return [row.lastName, row.firstName, row.middleName].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')
}

async function exportClientsTable(format: TableExportFormat) {
  if (!total.value) {
    notify({ color: 'warning', message: t('common.exportEmpty') })
    return
  }
  exportLoading.value = true
  try {
    const listQuery = { ...query.value }
    const { items: exportItems } = await fetchAllPaginatedItems<ClientRow>({
      pageSize: 100,
      fetchPage: async (pageNum, pageLimit) => {
        const { data } = await api.get('/clients', {
          params: buildClientsListApiParams({ ...listQuery, page: pageNum, limit: pageLimit }),
        })
        return { items: data.items as ClientRow[], total: data.total as number }
      },
    })
    if (!exportItems.length) {
      notify({ color: 'warning', message: t('common.exportEmpty') })
      return
    }
    const headers = [
      t('clients.fullName'),
      t('clients.inGym'),
      t('clients.phone'),
      t('clients.membership'),
      t('clients.daysLeftColumn'),
      t('clients.statusLabel'),
      t('clients.age'),
      t('clients.genderLabel'),
      t('clients.lastVisitDate'),
      t('clients.cardNumber'),
    ]
    const rows = exportItems.map((row) => {
      const remaining = getClientContractDaysLeft(
        row.effectiveContractStartDate ?? row.contractStartDate,
        row.effectiveContractEndDate ?? row.contractEndDate,
      )
      const gym = clientGymTableChip(row)
      const age = row.birthDate ? getAgeValue(row.birthDate.slice(0, 10)) : null
      const membershipLabel =
        row.membershipCatalogName?.trim() ||
        memberships.value.find((m) => m.value === row.membershipType)?.text ||
        '—'
      return [
        clientExportFullName(row),
        gym.label,
        row.phone ?? '',
        membershipLabel,
        remaining.daysLeft == null ? '—' : t('clients.daysLeftShort', { n: Math.max(0, remaining.daysLeft) }),
        t(`clients.status.${row.status}`),
        age == null ? '—' : String(age),
        row.gender ? t(`clients.gender.${row.gender}`) : t('clients.genderEmpty'),
        formatExportDateTime(row.lastVisitAt),
        row.cardNumber?.trim() || '—',
      ]
    })
    const periodCaption = formatExportPeriodCaption(
      filters.value.lastVisitFrom ?? '',
      filters.value.lastVisitTo ?? '',
      t,
    )
    downloadTableExport({
      format,
      filenameBase: 'clients',
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

const tableItems = computed(() =>
  items.value.map((item) => {
    const remaining = getClientContractDaysLeft(
      item.effectiveContractStartDate ?? item.contractStartDate,
      item.effectiveContractEndDate ?? item.contractEndDate,
    )
    const gymChip = clientGymTableChip(item)
    return {
      ...item,
      avatarUrl: clientPhotoDisplayUrl(item.photoUrl),
      membershipTypeId: item.membershipType,
      fullName: `${item.lastName} ${[item.firstName, item.middleName].filter(Boolean).map((v) => `${String(v).charAt(0)}.`).join('')}`.trim(),
      age: item.birthDate ? getAgeValue(item.birthDate.slice(0, 10)) : null,
      membershipType:
        item.membershipCatalogName?.trim() ||
        memberships.value.find((membership) => membership.value === item.membershipType)?.text ||
        '—',
      managerName:
        managers.value.find((m) => m.value === item.managerId)?.text || t('clients.noManager'),
      contractDaysText:
        remaining.daysLeft == null ? '—' : t('clients.daysLeftShort', { n: Math.max(0, remaining.daysLeft) }),
      contractDaysTone: remaining.tone,
      gymChipLabel: gymChip.label,
      gymChipTone: gymChip.tone,
      gymChipTitle: gymChip.title,
    }
  }),
)

const hasClients = computed(() => tableItems.value.length > 0)
const membershipOptions = computed(() => [{ value: '', text: '—' }, ...memberships.value])

const membershipOptionsForEdit = computed(() => {
  const base: Array<{ value: string; text: string }> = [{ value: '', text: '—' }, ...memberships.value]
  const extra = editMembershipExtraOption.value
  if (extra && !base.some((o) => o.value === extra.value)) {
    return [...base, extra]
  }
  return base
})
const editorStatusOptions = computed(
  () => statusFilterOptions.value.slice(1) as Array<{ value: ClientStatus; text: string }>,
)
async function flushClientFormPhoto(form: ClientEditorFormExpose | null): Promise<boolean> {
  if (!form?.flushPendingPhotoUpload) return true
  return await form.flushPendingPhotoUpload()
}

function onCreatePhotoDraftChanged(v: boolean) {
  createPhotoDraftPending.value = v
}

function onEditPhotoDraftChanged(v: boolean) {
  editPhotoDraftPending.value = v
}

const createDirty = computed(() => {
  const pending = createPhotoDraftPending.value
  return pending || JSON.stringify(createState.form.value) !== createInitialSnapshot.value
})
const editDirty = computed(() => {
  const pending = editPhotoDraftPending.value
  return pending || JSON.stringify(editState.form.value) !== editInitialSnapshot.value
})

function statusColor(status: ClientStatus) {
  if (status === 'ACTIVE') return 'success'
  if (status === 'PAUSED') return 'warning'
  if (status === 'BLOCKED') return 'danger'
  return 'neutral'
}

function statusLabel(status: ClientStatus) {
  return editorStatusOptions.value.find((option) => option.value === status)?.text || status
}

function formatRuDate(dateLike?: string | null) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU')
}

const editPauseUntilCompactLabel = computed(() => {
  if (!editPauseUntil.value) return ''
  const until = formatRuDate(editPauseUntil.value)
  const days = editPauseDurationDays.value
  if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
    return t('clients.pauseCompactWithDays', { until, days })
  }
  return t('clients.pauseCompactUntil', { until })
})

const editGymChip = computed(() => {
  const s = editHeaderSnapshot.value
  if (s.status !== 'ACTIVE') return null
  if (s.openVisitStatus != null || s.inGym === true) {
    return { label: t('clients.inGymYes'), tone: 'success' as const }
  }
  if (s.inGym === false) {
    return { label: t('clients.inGymNo'), tone: 'neutral' as const }
  }
  return null
})

function generateContractNumber(baseDate = new Date()) {
  const y = baseDate.getFullYear()
  const m = String(baseDate.getMonth() + 1).padStart(2, '0')
  const d = String(baseDate.getDate()).padStart(2, '0')
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `CTR-${y}${m}${d}-${suffix}`
}

function toDateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : ''
}

/** Даты из ContractDocument в ответе API (ISO-строка). */
function apiDateToFormIso(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  return value.slice(0, 10)
}

function toPayload(form: ClientForm, includeContractFields = true) {
  const basePayload = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    phone: form.phone.trim(),
    middleName: form.middleName.trim() || undefined,
    birthDate: form.birthDate || undefined,
    gender: form.gender || undefined,
    status: form.status,
    email: form.email.trim() || undefined,
    passport: form.passport.trim() || undefined,
    passportIssuedBy: form.passportIssuedBy.trim() || undefined,
    passportIssuedAt: form.passportIssuedAt || undefined,
    address: form.address.trim() || undefined,
    notes: form.notes.trim() || undefined,
    membershipType: form.membershipType || undefined,
    cardNumber: form.cardNumber.trim() || undefined,
    lockerNumber: form.lockerNumber.trim() || null,
    photoUrl: clientPhotoUrlForApiPayload(form.photoUrl),
  }
  if (!includeContractFields) return basePayload
  return {
    ...basePayload,
    contractNumber: form.contractNumber.trim() || undefined,
    contractStartDate: form.contractStartDate || undefined,
    contractEndDate: form.contractEndDate || undefined,
    paymentDate: form.paymentDate || undefined,
  }
}

function requiredInvalid(form: ClientForm) {
  const phoneDigits = form.phone.replace(/\D/g, '')
  return (
    !form.firstName.trim() ||
    !form.lastName.trim() ||
    phoneDigits.length < 11 ||
    !form.cardNumber.trim()
  )
}

function openCreate() {
  createAttempted.value = false
  createPhotoDraftPending.value = false
  createState.openForm()
  const now = new Date()
  const todayIso = formatDateIso(now)
  createState.form.value.contractStartDate = todayIso
  createState.form.value.paymentDate = todayIso
  createState.form.value.contractNumber = generateContractNumber(now)
  createInitialSnapshot.value = JSON.stringify(createState.form.value)
  createCardChecking.value = false
  createCardTaken.value = false
  void nextTick(() => createFormRef.value?.resetPhotoDraft())
}

function openCreateWithPrefilledCard(cardNumber: string) {
  openCreate()
  createState.form.value.cardNumber = cardNumber.trim()
  createInitialSnapshot.value = JSON.stringify(createState.form.value)
}

watch(
  () => ui.createClientFromScannerTick,
  async () => {
    const card = ui.createClientPrefillCardNumber.trim()
    if (!card) return
    ui.createClientPrefillCardNumber = ''
    if (route.name !== 'clients') {
      await router.push({ name: 'clients' })
      await nextTick()
    }
    openCreateWithPrefilledCard(card)
  },
)

function regenerateCreateContractNumber() {
  createState.form.value.contractNumber = generateContractNumber(new Date())
}

function regenerateEditContractNumber() {
  editState.form.value.contractNumber = generateContractNumber(new Date())
}

function clearEditClientUrlState() {
  if (editClientId.value) {
    editClientId.value = ''
    editClientTab.value = 'general'
  }
}

function onEditModalVisibilityChange(open: boolean) {
  if (open) {
    editModalOpen.value = true
    return
  }
  if (editModalOpening || !editModalOpen.value) return
  requestCloseEdit()
}

async function openEditClientFromUrlId(clientId: string, options?: { preserveTab?: boolean }) {
  const trimmed = clientId.trim()
  if (!trimmed) return
  if (editModalOpen.value && editingId.value === trimmed) return

  const requestId = ++editClientUrlOpenRequest
  try {
    const { data } = await api.get<ClientRow>(`/clients/${trimmed}`)
    if (requestId !== editClientUrlOpenRequest) return
    await openEdit(data, { preserveTab: options?.preserveTab ?? true, syncUrl: false, skipFetch: true })
  } catch {
    if (requestId !== editClientUrlOpenRequest) return
    notify({ color: 'danger', message: t('clients.loadFailed') })
    if (editClientId.value === trimmed) clearEditClientUrlState()
  }
}

async function openEdit(
  row: ClientRow,
  options?: { preserveTab?: boolean; syncUrl?: boolean; skipFetch?: boolean },
) {
  editAttempted.value = false
  editPhotoDraftPending.value = false
  editingId.value = row.id
  if (!options?.preserveTab) {
    editClientTab.value = 'general'
  }

  let client = row
  if (!options?.skipFetch) {
    editModalOpening = true
    try {
      const { data } = await api.get<ClientRow>(`/clients/${row.id}`)
      client = data
    } catch {
      notify({ color: 'danger', message: t('clients.loadFailed') })
      editModalOpening = false
      return
    }
  }

  const catalogId = client.membershipType?.trim() || ''
  editMembershipExtraOption.value = null
  if (catalogId && !memberships.value.some((m) => m.value === catalogId)) {
    editMembershipExtraOption.value = {
      value: catalogId,
      text: client.membershipCatalogName?.trim() || catalogId,
    }
  }
  editModalOpening = true
  editState.openForm({
    firstName: client.firstName || '',
    lastName: client.lastName || '',
    phone: client.phone || '',
    middleName: client.middleName || '',
    birthDate: client.birthDate ? client.birthDate.slice(0, 10) : '',
    gender: client.gender || '',
    status: client.status || 'ACTIVE',
    email: client.email || '',
    passport: client.passport || '',
    passportIssuedBy: client.passportIssuedBy || '',
    passportIssuedAt: client.passportIssuedAt ? client.passportIssuedAt.slice(0, 10) : '',
    address: client.address || '',
    notes: client.notes || '',
    contractNumber: client.contractNumber || '',
    contractStartDate: toDateOnly(client.contractStartDate),
    contractEndDate: toDateOnly(client.contractEndDate),
    paymentDate: toDateOnly(client.paymentDate) || toDateOnly(client.contractStartDate) || toDateOnly(client.createdAt),
    membershipType: catalogId,
    cardNumber: client.cardNumber || '',
    lockerNumber: sanitizeLockerDigits(client.lockerNumber ?? ''),
    photoUrl: client.photoUrl || '',
  })
  void nextTick(() => {
    editModalOpening = false
  })
  const gymHeader = resolveClientGymHeaderState(client)
  editHeaderSnapshot.value = {
    headline: getPersonHeadline(editState.form.value),
    status: client.status || 'ACTIVE',
    inGym: gymHeader.inGym,
    openVisitStatus: gymHeader.openVisitStatus,
  }
  editInitialSnapshot.value = JSON.stringify(editState.form.value)
  editCardChecking.value = false
  editCardTaken.value = false
  editLockerTaken.value = false
  editLockerChecking.value = false
  const requestId = ++editHistoryRequestId.value
  resetEditVisitsHistoryState()
  void Promise.all([loadEditContractsHistory(client.id, requestId), loadEditPaymentsHistory(client.id, requestId)])
  void nextTick(() => editFormRef.value?.resetPhotoDraft())
  if (options?.syncUrl !== false) {
    editClientId.value = client.id
  }
}

function closeClientRowActionsMenu() {
  clientsRowMenuOpenId.value = null
  clientsRowMenuRow.value = null
  clientsRowMenuAnchorRect.value = null
}

/** Список: новый договор (в т.ч. очередной) — для всех, кроме заблокированных. */
function clientRowShowsGenerateContract(row: ClientRow) {
  return row.status !== 'BLOCKED'
}

const clientsRowMenuLayerStyle = computed(() => {
  const r = clientsRowMenuAnchorRect.value
  if (!r || typeof window === 'undefined') return {}
  const gap = 6
  const reserve = 10
  const winW = window.innerWidth
  const winH = window.innerHeight
  /** Оценка высоты меню (пункты + отступы); при нехватке места включается скролл. */
  const estMenuPx = 260
  const spaceBelow = winH - r.bottom - gap - reserve
  const spaceAbove = r.top - gap - reserve
  const openAbove =
    spaceBelow < Math.min(estMenuPx, 200) && spaceAbove > spaceBelow && spaceAbove > 80

  const maxH = Math.max(100, Math.min(openAbove ? spaceAbove : spaceBelow, winH - reserve * 2))

  const base: Record<string, string> = {
    position: 'fixed',
    right: `${winW - r.right}px`,
    zIndex: '4000',
    maxHeight: `${maxH}px`,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
  }

  if (openAbove) {
    return {
      ...base,
      bottom: `${winH - r.top + gap}px`,
      top: 'auto',
    }
  }
  return {
    ...base,
    top: `${r.bottom + gap}px`,
    bottom: 'auto',
  }
})

function onRowMenuTriggerClick(row: ClientRow, ev: MouseEvent) {
  const el = ev.currentTarget
  if (!(el instanceof HTMLElement)) return
  if (clientsRowMenuOpenId.value === row.id) {
    closeClientRowActionsMenu()
    return
  }
  clientsRowMenuOpenId.value = row.id
  clientsRowMenuRow.value = row
  clientsRowMenuAnchorRect.value = el.getBoundingClientRect()
}

/** Строка меню передаётся аргументом: до вызова обнуляется `clientsRowMenuRow`, колбэк без аргумента получил бы `null`. */
function runRowMenuAction(row: ClientRow | null, action: (r: ClientRow) => void) {
  if (!row) return
  closeClientRowActionsMenu()
  action(row)
}

type ClientsTableRowClickPayload = {
  event: Event
  item: Record<string, unknown>
  itemIndex: number
}

function handleClientsTableRowClick(payload: ClientsTableRowClickPayload) {
  if (loading.value || editState.loading.value || createState.loading.value) return
  const t = payload.event.target
  if (!(t instanceof Element)) return
  if (t.closest('.clients-row-menu-layer')) return
  if (t.closest('.clients-row-menu__trigger')) return
  if (t.closest('.clients-gym-chip-trigger')) return
  if (t.closest('.clients-table-actions-cell')) return
  closeClientRowActionsMenu()
  void openEdit(payload.item as unknown as ClientRow)
}

function onDocumentPointerDownCloseRowMenu(ev: Event) {
  const t = ev.target
  if (!(t instanceof Element)) return
  if (t.closest('.clients-row-menu-layer')) return
  if (t.closest('.clients-row-menu__trigger')) return
  closeClientRowActionsMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDownCloseRowMenu, true)
  window.addEventListener('resize', closeClientRowActionsMenu, { passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDownCloseRowMenu, true)
  window.removeEventListener('resize', closeClientRowActionsMenu)
})

watch(
  editClientId,
  (id) => {
    const trimmed = typeof id === 'string' ? id.trim() : ''
    if (!trimmed) {
      if (editModalOpen.value) requestCloseEdit()
      return
    }
    if (editModalOpen.value && editingId.value === trimmed) return
    void openEditClientFromUrlId(trimmed, { preserveTab: true })
  },
  { flush: 'post', immediate: true },
)

function requestCloseCreate() {
  if (createState.loading.value) return
  if (createDirty.value) {
    discardTarget.value = 'create'
    discardOpen.value = true
    return
  }
  createState.closeForm()
  void nextTick(() => createFormRef.value?.resetPhotoDraft())
}

function requestCloseEdit() {
  if (editState.loading.value) return
  if (editDirty.value) {
    discardTarget.value = 'edit'
    discardOpen.value = true
    return
  }
  editClientUrlOpenRequest += 1
  editState.closeForm()
  clearEditClientUrlState()
  void nextTick(() => editFormRef.value?.resetPhotoDraft())
}

function discardChanges() {
  if (discardTarget.value === 'create') {
    createState.closeForm()
    void nextTick(() => createFormRef.value?.resetPhotoDraft())
  } else if (discardTarget.value === 'edit') {
    editClientUrlOpenRequest += 1
    editState.closeForm()
    clearEditClientUrlState()
    void nextTick(() => editFormRef.value?.resetPhotoDraft())
  }
  discardOpen.value = false
  discardTarget.value = null
}

async function openScannerTargetClient(id: string) {
  const existing = items.value.find((item) => item.id === id)
  if (existing) {
    await openEdit(existing)
    ui.setScannerTargetClientId(null)
    return
  }

  try {
    const { data } = await api.get<ClientRow>(`/clients/${id}`)
    await openEdit(data, { skipFetch: true })
    ui.setScannerTargetClientId(null)
  } catch (error: unknown) {
    ui.setScannerTargetClientId(null)
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(error, {
        defaultMessage: t('header.scannerLookupFailed'),
        byStatus: { 404: t('header.scannerNotFound') },
      }),
    })
  }
}

function openScannerFromGymChip(row: ClientRow) {
  ui.requestScannerLookup({ clientId: row.id })
}

async function createClient() {
  createAttempted.value = true
  await nextTick()
  createFormRef.value?.validateSubmitFields()
  if (requiredInvalid(createState.form.value) || createCardTaken.value) {
    createState.error.value = null
    createFormRef.value?.focusFirstInvalid()
    return
  }
  createState.loading.value = true
  createState.error.value = null
  try {
    const photoOk = await flushClientFormPhoto(createFormRef.value)
    if (!photoOk) {
      createState.error.value = t('clients.photoUploadFailed')
      return
    }
    await api.post('/clients', toPayload(createState.form.value))
    createState.closeForm()
    createInitialSnapshot.value = ''
    notify({ color: 'success', message: t('clients.createdSuccess') })
    await clientsSource.reload()
  } catch (e: unknown) {
    createState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('clients.createFailed'),
      byStatus: { 400: t('clients.apiFormError'), 409: t('clients.uniqueClientNumberTaken') },
      byCode: {
        CARD_NUMBER_EXISTS: t('clients.cardNumberTaken'),
        CONTRACT_NUMBER_EXISTS: t('clients.contractNumberTaken'),
        CARD_NUMBER_REQUIRED: t('clients.apiFormError'),
        CONTRACT_NUMBER_REQUIRED: t('clients.apiFormError'),
        PHOTO_DATA_URL_NOT_ALLOWED: t('clients.photoDataUrlNotAllowed'),
      },
    })
  } finally {
    createState.loading.value = false
  }
}

async function updateClient() {
  if (!editingId.value) return
  editAttempted.value = true
  await nextTick()
  editFormRef.value?.validateSubmitFields()
  if (requiredInvalid(editState.form.value) || editCardTaken.value || editLockerTaken.value) {
    editState.error.value = null
    editFormRef.value?.focusFirstInvalid()
    return
  }
  editState.loading.value = true
  editState.error.value = null
  try {
    const photoOk = await flushClientFormPhoto(editFormRef.value)
    if (!photoOk) {
      editState.error.value = t('clients.photoUploadFailed')
      return
    }
    await api.patch(`/clients/${editingId.value}`, toPayload(editState.form.value, false))
    editClientUrlOpenRequest += 1
    editState.closeForm()
    clearEditClientUrlState()
    editInitialSnapshot.value = ''
    notify({ color: 'success', message: t('clients.updatedSuccess') })
    await clientsSource.reload()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('clients.updateFailed'),
      byStatus: { 400: t('clients.apiFormError'), 409: t('clients.uniqueClientNumberTaken') },
      byCode: {
        CARD_NUMBER_EXISTS: t('clients.cardNumberTaken'),
        CONTRACT_NUMBER_EXISTS: t('clients.contractNumberTaken'),
        CARD_NUMBER_REQUIRED: t('clients.apiFormError'),
        CONTRACT_NUMBER_REQUIRED: t('clients.apiFormError'),
        LOCKER_REQUIRES_ACTIVE_CONTRACT: t('clients.lockerRequiresActiveContract'),
        LOCKER_NUMBER_EXISTS: t('clients.lockerNumberTaken'),
        PHOTO_DATA_URL_NOT_ALLOWED: t('clients.photoDataUrlNotAllowed'),
      },
    })
  } finally {
    editState.loading.value = false
  }
}

function pickPrimaryContractDocForEdit<
  T extends { id: string; status?: string; createdAt: string },
>(items: T[]): T | undefined {
  const active = items.filter((i) => i.status === 'ACTIVE')
  const pool = active.length > 0 ? active : items.filter((i) => i.status === 'PAUSED')
  if (pool.length === 0) return undefined
  let best = pool[0]!
  let bestCreated = new Date(best.createdAt).getTime()
  let bestId = best.id
  for (const c of pool) {
    const ct = new Date(c.createdAt).getTime()
    if (ct > bestCreated || (ct === bestCreated && c.id > bestId)) {
      best = c
      bestCreated = ct
      bestId = c.id
    }
  }
  return best
}

async function loadEditContractsHistory(clientId: string, requestId = editHistoryRequestId.value) {
  editContractsLoading.value = true
  try {
    const { data } = await api.get(`/contracts/client/${clientId}`)
    if (editingId.value !== clientId || requestId !== editHistoryRequestId.value) return
    editContractsHistory.value = Array.isArray(data) ? data : []
    const paused = editContractsHistory.value.find((item) => item.status === 'PAUSED' && item.pauseUntil)
    editPauseUntil.value = paused?.pauseUntil ?? null
    const pd = paused?.pauseDurationDays
    editPauseDurationDays.value =
      typeof pd === 'number' && Number.isFinite(pd) && pd > 0 ? Math.floor(pd) : null
    const primaryDoc = pickPrimaryContractDocForEdit(editContractsHistory.value)
    if (editingId.value === clientId && requestId === editHistoryRequestId.value && primaryDoc) {
      const docNumber = primaryDoc.contractNumber?.trim()
      const startFromDoc = apiDateToFormIso(primaryDoc.serviceStartDate ?? undefined)
      const endFromDoc = apiDateToFormIso(primaryDoc.serviceEndDate ?? undefined)
      const payFromDoc = apiDateToFormIso(primaryDoc.contractDate ?? undefined)
      const next = { ...editState.form.value }
      let changed = false
      if (docNumber && next.contractNumber.trim() !== docNumber) {
        next.contractNumber = docNumber
        changed = true
      }
      if (startFromDoc && next.contractStartDate !== startFromDoc) {
        next.contractStartDate = startFromDoc
        changed = true
      }
      if (endFromDoc && next.contractEndDate !== endFromDoc) {
        next.contractEndDate = endFromDoc
        changed = true
      }
      if (payFromDoc && next.paymentDate !== payFromDoc) {
        next.paymentDate = payFromDoc
        changed = true
      }
      if (changed) {
        editState.form.value = next
        editInitialSnapshot.value = JSON.stringify(editState.form.value)
      }
    }
  } catch {
    if (editingId.value !== clientId || requestId !== editHistoryRequestId.value) return
    editContractsHistory.value = []
    editPauseUntil.value = null
    editPauseDurationDays.value = null
  } finally {
    if (requestId !== editHistoryRequestId.value) return
    editContractsLoading.value = false
  }
}

async function loadEditPaymentsHistory(clientId: string, requestId = editHistoryRequestId.value) {
  editPaymentsLoading.value = true
  try {
    const { data } = await api.get(`/payments/client/${clientId}`)
    if (editingId.value !== clientId || requestId !== editHistoryRequestId.value) return
    editPaymentsHistory.value = Array.isArray(data) ? data : []
  } catch {
    if (editingId.value !== clientId || requestId !== editHistoryRequestId.value) return
    editPaymentsHistory.value = []
  } finally {
    if (requestId !== editHistoryRequestId.value) return
    editPaymentsLoading.value = false
  }
}

function resetEditVisitsHistoryState() {
  editVisitsHistory.value = []
  editVisitsLoading.value = false
  editVisitsPage.value = 1
  editVisitsLimit.value = DEFAULT_TABLE_PAGE_LIMIT
  editVisitsTotal.value = 0
  editVisitsFrom.value = ''
  editVisitsTo.value = ''
  editVisitsRequestId.value += 1
}

async function loadEditVisitsHistory(clientId: string, requestId = editVisitsRequestId.value) {
  editVisitsLoading.value = true
  try {
    const params: Record<string, string> = {
      clientId,
      page: String(editVisitsPage.value),
      limit: String(editVisitsLimit.value),
      sortBy: 'enteredAt',
      sortOrder: 'desc',
    }
    if (editVisitsFrom.value.trim()) params.from = editVisitsFrom.value.trim().slice(0, 10)
    if (editVisitsTo.value.trim()) params.to = editVisitsTo.value.trim().slice(0, 10)
    const { data } = await api.get('/visits', { params })
    if (editingId.value !== clientId || requestId !== editVisitsRequestId.value) return
    if (Array.isArray(data)) {
      editVisitsHistory.value = data
      editVisitsTotal.value = data.length
      return
    }
    const typed = data as {
      items?: typeof editVisitsHistory.value
      meta?: { total?: number; page?: number; limit?: number }
    }
    editVisitsHistory.value = Array.isArray(typed.items) ? typed.items : []
    editVisitsTotal.value = Number.isFinite(typed.meta?.total)
      ? Number(typed.meta?.total)
      : editVisitsHistory.value.length
  } catch {
    if (editingId.value !== clientId || requestId !== editVisitsRequestId.value) return
    editVisitsHistory.value = []
    editVisitsTotal.value = 0
  } finally {
    if (requestId !== editVisitsRequestId.value) return
    editVisitsLoading.value = false
  }
}

function onEditVisitsTabOpen() {
  const clientId = editingId.value
  if (!clientId) return
  const requestId = editVisitsRequestId.value
  void loadEditVisitsHistory(clientId, requestId)
}

function onEditVisitsPageChange(page: number) {
  editVisitsPage.value = page
  const clientId = editingId.value
  if (!clientId) return
  void loadEditVisitsHistory(clientId)
}

function onEditVisitsLimitChange(limit: number) {
  editVisitsLimit.value = limit
  editVisitsPage.value = 1
  const clientId = editingId.value
  if (!clientId) return
  void loadEditVisitsHistory(clientId)
}

function onEditVisitsFromChange(from: string) {
  editVisitsFrom.value = from
  editVisitsPage.value = 1
  const clientId = editingId.value
  if (!clientId) return
  void loadEditVisitsHistory(clientId)
}

function onEditVisitsToChange(to: string) {
  editVisitsTo.value = to
  editVisitsPage.value = 1
  const clientId = editingId.value
  if (!clientId) return
  void loadEditVisitsHistory(clientId)
}

function onEditVisitsResetFilters() {
  editVisitsFrom.value = ''
  editVisitsTo.value = ''
  editVisitsPage.value = 1
  const clientId = editingId.value
  if (!clientId) return
  void loadEditVisitsHistory(clientId)
}

async function onAddContractPayment(payload: {
  contractDocumentId: string
  amount: number
  paidAt: string
  channel: 'CASH' | 'NON_CASH'
}) {
  const clientId = editingId.value
  if (!clientId) return
  addContractPaymentLoading.value = true
  const paidAtRaw = payload.paidAt.trim()
  const paidAtForApi =
    paidAtRaw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(paidAtRaw)
      ? isoCalendarDateAtNowLocalTimeToUtcIso(paidAtRaw)
      : paidAtRaw || new Date().toISOString()
  try {
    await api.post('/payments', {
      clientId,
      contractDocumentId: payload.contractDocumentId,
      amount: payload.amount,
      paidAt: paidAtForApi,
      status: 'PAID',
      channel: payload.channel,
      comment: 'Contract installment payment',
    })
    notify({ color: 'success', message: t('clients.paymentCreated') })
    ui.bumpPaymentsTableRefresh()
    await Promise.all([loadEditPaymentsHistory(clientId), loadEditContractsHistory(clientId)])
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, {
        defaultMessage: t('clients.paymentCreateFailed'),
        byCode: {
          PAYMENT_EXCEEDS_CONTRACT_BALANCE: t('clients.paymentExceedsContractBalance'),
        },
      }),
    })
  } finally {
    addContractPaymentLoading.value = false
  }
}

async function generateContractForEditingClient() {
  if (!editingId.value) return
  if (editDirty.value) {
    generateConfirmOpen.value = true
    return
  }
  await proceedGenerateContractForEditingClient()
}

/**
 * Проверка can-generate и переход на страницу договора с черновиком.
 * Без открытия модалки клиента — от таблицы вызывать с seed из строки.
 */
function canGenerateFailMessage(reason?: string): string {
  switch (reason) {
    case 'CONTRACT_NUMBER_REQUIRED':
      return t('clients.contractNumberRequired')
    case 'CONTRACT_NUMBER_EXISTS':
      return t('clients.contractNumberTaken')
    case 'ACTIVE_CONTRACT_EXISTS':
      return t('clients.activeContractAlreadyExists')
    default:
      return t('clients.contractGenerateFailed')
  }
}

async function proceedGenerateContractNavigation(
  clientId: string,
  seedContractNumber: string,
  options?: { syncContractNumberToEditForm?: boolean; queueContract?: boolean },
) {
  let contractNumber = seedContractNumber.trim()
  if (!contractNumber) {
    contractNumber = generateContractNumber(new Date())
    if (options?.syncContractNumberToEditForm) {
      editState.form.value.contractNumber = contractNumber
    }
  }
  if (options?.queueContract) {
    await router.push({
      name: 'contracts',
      query: {
        clientId,
        newContract: '1',
        contractNumber: contractNumber.trim(),
        queueContract: '1',
      },
    })
    return
  }

  const maxAttempts = 8
  let canGenerate = false
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data } = await api.get<{ ok: boolean; reason?: string }>(
        `/contracts/client/${clientId}/can-generate`,
        {
          params: { contractNumber, _t: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        },
      )
      if (data?.ok === true) {
        canGenerate = true
        break
      }
      if (data?.reason === 'CONTRACT_NUMBER_EXISTS') {
        contractNumber = generateContractNumber(new Date())
        if (options?.syncContractNumberToEditForm) {
          editState.form.value.contractNumber = contractNumber
        }
        continue
      }
      notify({
        color: 'warning',
        message: canGenerateFailMessage(data?.reason),
      })
      return
    }
    if (!canGenerate) {
      notify({ color: 'danger', message: t('clients.contractNumberTaken') })
      return
    }
  } catch {
    notify({ color: 'danger', message: t('clients.contractGenerateFailed') })
    return
  }
  await router.push({
    name: 'contracts',
    query: {
      clientId,
      newContract: '1',
      contractNumber: contractNumber.trim() || undefined,
      ...(options?.queueContract ? { queueContract: '1' } : {}),
    },
  })
}

async function generateContractFromTableRow(row: ClientRow) {
  contractGenerateLoadingId.value = row.id
  try {
    const queueContract = row.status === 'ACTIVE' || row.status === 'PAUSED'
    await proceedGenerateContractNavigation(row.id, generateContractNumber(new Date()), { queueContract })
  } finally {
    contractGenerateLoadingId.value = null
  }
}

async function saveAndGenerateContract() {
  if (!editingId.value) return
  if (!editState.form.value.contractNumber.trim()) {
    regenerateEditContractNumber()
  }
  editAttempted.value = true
  await nextTick()
  editFormRef.value?.validateSubmitFields()
  if (requiredInvalid(editState.form.value) || editCardTaken.value || editLockerTaken.value) {
    editState.error.value = null
    editFormRef.value?.focusFirstInvalid()
    return
  }
  editState.loading.value = true
  editState.error.value = null
  try {
    const photoOk = await flushClientFormPhoto(editFormRef.value)
    if (!photoOk) {
      editState.error.value = t('clients.photoUploadFailed')
      return
    }
    await api.patch(`/clients/${editingId.value}`, toPayload(editState.form.value, false))
    editInitialSnapshot.value = JSON.stringify(editState.form.value)
    generateConfirmOpen.value = false
    await clientsSource.reload()
    await proceedGenerateContractForEditingClient()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('clients.updateFailed'),
      byStatus: { 400: t('clients.apiFormError'), 409: t('clients.uniqueClientNumberTaken') },
      byCode: {
        CARD_NUMBER_EXISTS: t('clients.cardNumberTaken'),
        CONTRACT_NUMBER_EXISTS: t('clients.contractNumberTaken'),
        CARD_NUMBER_REQUIRED: t('clients.apiFormError'),
        CONTRACT_NUMBER_REQUIRED: t('clients.apiFormError'),
        LOCKER_REQUIRES_ACTIVE_CONTRACT: t('clients.lockerRequiresActiveContract'),
        LOCKER_NUMBER_EXISTS: t('clients.lockerNumberTaken'),
        PHOTO_DATA_URL_NOT_ALLOWED: t('clients.photoDataUrlNotAllowed'),
      },
    })
  } finally {
    editState.loading.value = false
  }
}

async function proceedGenerateContractForEditingClient() {
  if (!editingId.value) return
  const queueContract =
    editHeaderSnapshot.value.status === 'ACTIVE' ||
    editHeaderSnapshot.value.status === 'PAUSED' ||
    editContractsHistory.value.some((item) => item.status === 'ACTIVE' || item.status === 'PAUSED')
  const hasAnyContract =
    editContractsHistory.value.length > 0 ||
    editHeaderSnapshot.value.status === 'ACTIVE' ||
    editHeaderSnapshot.value.status === 'PAUSED'
  // Номер в форме — у действующего договора; для нового (очередного) всегда новый CTR-…
  const seed =
    queueContract || hasAnyContract
      ? generateContractNumber(new Date())
      : editState.form.value.contractNumber.trim() || generateContractNumber(new Date())
  await proceedGenerateContractNavigation(editingId.value, seed, {
    syncContractNumberToEditForm: false,
    queueContract,
  })
}

async function openContractFromHistory(contractId: string) {
  if (!editingId.value) return
  try {
    const { data: openData } = await api.get<{ url: string | null }>(`/contracts/${contractId}/open-url`)
    if (openData?.url) {
      window.open(openData.url, '_blank')
      return
    }
    const { data } = await api.post(
      `/contracts/client/${editingId.value}/${contractId}/generate`,
      undefined,
      { responseType: 'blob' },
    )
    const blob = data instanceof Blob ? data : new Blob([data])
    if (!blob.type.includes('pdf')) {
      throw new Error('PDF response expected')
    }
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, { defaultMessage: t('clients.contractOpenFailed') })
  }
}

function applyEditedClientRowFromList(clientId: string) {
  const row = items.value.find((item) => item.id === clientId)
  if (!row) return
  if (
    row.status === 'ACTIVE' ||
    row.status === 'PAUSED' ||
    row.status === 'INACTIVE' ||
    row.status === 'BLOCKED'
  ) {
    editState.form.value.status = row.status
    const gymHeader = resolveClientGymHeaderState(row)
    editHeaderSnapshot.value = {
      ...editHeaderSnapshot.value,
      status: row.status,
      inGym: gymHeader.inGym,
      openVisitStatus: gymHeader.openVisitStatus,
    }
  }
}

async function reloadEditedClientContractState() {
  if (!editingId.value) return
  const requestId = ++editHistoryRequestId.value
  const clientId = editingId.value
  await Promise.all([
    loadEditContractsHistory(clientId, requestId),
    loadEditPaymentsHistory(clientId, requestId),
    clientsSource.reload(),
  ])
  applyEditedClientRowFromList(clientId)
}

function resolveMembershipDurationForContract(item: { serviceName?: string | null }) {
  const name = item.serviceName?.trim()
  if (!name) return null
  const matched = memberships.value.find((m) => m.text.trim() === name)
  if (!matched?.durationValue || !matched.durationUnit) return null
  return { durationValue: matched.durationValue, durationUnit: matched.durationUnit }
}

function syncActivateEndDate() {
  const start = activateForm.value.serviceStartDate.trim()
  if (!start || !activateDuration.value) {
    activateForm.value.serviceEndDate = ''
    return
  }
  activateForm.value.serviceEndDate = calculateEndDate(
    start,
    activateDuration.value.durationValue,
    activateDuration.value.durationUnit,
  )
}

function openActivateContractFromHistory(contractId: string) {
  const hasBlocking = editContractsHistory.value.some(
    (row) =>
      row.id !== contractId && (row.status === 'ACTIVE' || row.status === 'PAUSED'),
  )
  if (hasBlocking) {
    notify({ color: 'warning', message: t('contracts.activateBlockedActiveExists') })
    return
  }
  const item = editContractsHistory.value.find((row) => row.id === contractId)
  if (item?.status !== 'SAVED') {
    notify({ color: 'warning', message: t('contracts.onlySavedCanActivate') })
    return
  }
  activateTargetId.value = contractId
  activateDuration.value = item ? resolveMembershipDurationForContract(item) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  activateForm.value = {
    serviceStartDate: today.toISOString().slice(0, 10),
    serviceEndDate: '',
  }
  syncActivateEndDate()
  activateUiError.value = null
  activateOpen.value = true
}

watch(
  () => activateForm.value.serviceStartDate,
  () => {
    if (activateOpen.value) syncActivateEndDate()
  },
)

async function submitActivateFromHistory() {
  if (!activateTargetId.value) return
  if (!activateForm.value.serviceStartDate.trim()) {
    activateUiError.value = t('contracts.serviceStartDate')
    return
  }
  syncActivateEndDate()
  if (!activateForm.value.serviceEndDate.trim()) {
    activateUiError.value = t('clients.activateEndDateMissing')
    return
  }
  activateLoading.value = true
  activateUiError.value = null
  try {
    await api.patch(`/contracts/${activateTargetId.value}/activate`, {
      serviceStartDate: activateForm.value.serviceStartDate,
      serviceEndDate: activateForm.value.serviceEndDate.trim() || undefined,
    })
    activateOpen.value = false
    activateTargetId.value = null
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    activateUiError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
        ONLY_SAVED_CAN_ACTIVATE: t('contracts.onlySavedCanActivate'),
        ACTIVE_MEMBERSHIP_BLOCKS_ACTIVATE: t('contracts.activateBlockedActiveExists'),
        SERVICE_START_REQUIRED: t('contracts.serviceStartDate'),
        SERVICE_END_REQUIRED: t('clients.activateEndDateMissing'),
        SERVICE_DATE_RANGE_INVALID: t('contracts.saveFailed'),
        ACTIVE_CONTRACT_EXISTS: t('clients.activeContractAlreadyExists'),
      },
    })
  } finally {
    activateLoading.value = false
  }
}

async function pauseContractFromHistory(contractId: string) {
  freezeTargetId.value = contractId
  freezeUiError.value = null
  freezeOpen.value = true
}

async function submitFreezeFromHistory(payload: { startDate: string; endDate: string; reason: string }) {
  if (!freezeTargetId.value) return
  freezeLoading.value = true
  freezeUiError.value = null
  try {
    await api.patch(`/contracts/${freezeTargetId.value}/pause`, {
      startDate: payload.startDate,
      endDate: payload.endDate,
      reason: payload.reason || undefined,
    })
    freezeOpen.value = false
    freezeTargetId.value = null
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    freezeUiError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
        CANNOT_PAUSE_FINISHED_CONTRACT: t('contracts.statusUpdateFailed'),
        FREEZE_DURATION_INVALID: t('contracts.freezeDurationInvalid'),
        FREEZE_OUT_OF_CONTRACT_RANGE: t('contracts.freezeOutOfRange'),
        FREEZE_OVERLAPS: t('contracts.freezeOverlaps'),
        ONLY_ACTIVE_CAN_FREEZE: t('contracts.onlyActiveCanFreeze'),
      },
    })
  } finally {
    freezeLoading.value = false
  }
}

function askResumeContractFromHistory(contractId: string) {
  resumeTargetId.value = contractId
  resumeUiError.value = null
  resumeOpen.value = true
}

async function submitResumeFromHistory() {
  if (!resumeTargetId.value) return
  resumeLoading.value = true
  resumeUiError.value = null
  try {
    await api.patch(`/contracts/${resumeTargetId.value}/resume`)
    resumeOpen.value = false
    resumeTargetId.value = null
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    resumeUiError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
        ONLY_PAUSED_CAN_RESUME: t('contracts.onlyPausedCanResume'),
      },
    })
  } finally {
    resumeLoading.value = false
  }
}

async function terminateContractFromHistory(contractId: string) {
  const item = editContractsHistory.value.find((row) => row.id === contractId)
  cancelTarget.value = { id: contractId, contractNumber: item?.contractNumber || '—' }
  cancelForm.value = {
    refundAmount:
      item?.servicePrice == null || Number.isNaN(Number(item.servicePrice))
        ? '0'
        : Number(item.servicePrice).toFixed(2),
    refundMethod: 'CASH',
    comment: '',
  }
  cancelOpen.value = true
}

async function submitCancelFromHistory() {
  if (!cancelTarget.value) return
  cancelLoading.value = true
  try {
    await api.post(`/contracts/${cancelTarget.value.id}/cancel-with-refund`, {
      refundAmount: cancelForm.value.refundAmount,
      refundMethod: cancelForm.value.refundMethod,
      comment: cancelForm.value.comment.trim() || undefined,
    })
    cancelOpen.value = false
    cancelTarget.value = null
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
        REFUND_LIMIT_EXCEEDED: t('contracts.refundExceedsPaid'),
        REFUND_METHOD_REQUIRED: t('contracts.refundMethodRequired'),
      },
    })
  } finally {
    cancelLoading.value = false
  }
}

function askDelete(row: ClientRow) {
  deletingClient.value = row
  deleteOpen.value = true
  deleteError.value = null
}

async function deleteClient() {
  if (!deletingClient.value) return
  deleteLoading.value = true
  deleteError.value = null
  try {
    await api.delete(`/clients/${deletingClient.value.id}`)
    deleteOpen.value = false
    notify({ color: 'success', message: t('clients.deletedSuccess') })
    await clientsSource.reload()
  } catch (e: unknown) {
    deleteError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('clients.deleteFailed'),
      byStatus: { 403: t('clients.forbidden') },
    })
  } finally {
    deleteLoading.value = false
  }
}

async function blockClient(row: ClientRow) {
  if (statusActionLoadingId.value) return
  blockTarget.value = row
  blockOpen.value = true
}

async function confirmBlockClient() {
  if (!blockTarget.value || statusActionLoadingId.value) return
  const row = blockTarget.value
  if (statusActionLoadingId.value) return
  statusActionLoadingId.value = row.id
  try {
    await api.patch(`/clients/${row.id}/block`)
    blockOpen.value = false
    blockTarget.value = null
    notify({ color: 'success', message: t('clients.blockedSuccess') })
    if (editingId.value === row.id) {
      await reloadEditedClientContractState()
    } else {
      await clientsSource.reload()
    }
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, { defaultMessage: t('clients.blockFailed') }),
    })
  } finally {
    statusActionLoadingId.value = null
  }
}

async function unblockClient(row: ClientRow) {
  if (statusActionLoadingId.value) return
  unblockTarget.value = row
  unblockOpen.value = true
}

async function confirmUnblockClient() {
  if (!unblockTarget.value || statusActionLoadingId.value) return
  const row = unblockTarget.value
  if (statusActionLoadingId.value) return
  statusActionLoadingId.value = row.id
  try {
    await api.patch(`/clients/${row.id}/unblock`)
    unblockOpen.value = false
    unblockTarget.value = null
    notify({ color: 'success', message: t('clients.unblockedSuccess') })
    if (editingId.value === row.id) {
      await reloadEditedClientContractState()
    } else {
      await clientsSource.reload()
    }
  } catch (e: unknown) {
    notify({
      color: 'danger',
      message: resolveApiErrorMessage(e, { defaultMessage: t('clients.unblockFailed') }),
    })
  } finally {
    statusActionLoadingId.value = null
  }
}

watch(
  () => blockOpen.value,
  (open) => {
    if (!open) blockTarget.value = null
  },
)

watch(
  () => unblockOpen.value,
  (open) => {
    if (!open) unblockTarget.value = null
  },
)

watch(
  () => createState.open.value,
  (open) => {
    if (!open) {
      createAttempted.value = false
      createState.resetForm()
      createState.error.value = null
      createInitialSnapshot.value = ''
      createCardChecking.value = false
      createCardTaken.value = false
    }
  },
)

watch(
  () => editState.open.value,
  (open) => {
    if (!open) {
      editHistoryRequestId.value += 1
      editAttempted.value = false
      editingId.value = null
      editContractsHistory.value = []
      editPaymentsHistory.value = []
      resetEditVisitsHistoryState()
      editMembershipExtraOption.value = null
      editPauseUntil.value = null
      editPauseDurationDays.value = null
      editState.resetForm()
      editState.error.value = null
      editInitialSnapshot.value = ''
      editCardChecking.value = false
      editCardTaken.value = false
  editLockerTaken.value = false
  editLockerChecking.value = false
      clearEditClientUrlState()
    }
  },
)

watch(
  () => editState.form.value.membershipType,
  (id) => {
    const extra = editMembershipExtraOption.value
    if (!extra) return
    if (id !== extra.value) editMembershipExtraOption.value = null
  },
)

watch(
  () => createState.form.value.cardNumber,
  (value) => {
    const candidate = value.trim()
    createCardTaken.value = false
    if (createCardTimer) clearTimeout(createCardTimer)
    if (!candidate) {
      createCardChecking.value = false
      return
    }
    createCardTimer = setTimeout(async () => {
      createCardChecking.value = true
      try {
        const { data } = await api.get('/clients/validate-card', { params: { cardNumber: candidate } })
        createCardTaken.value = !(data as { available: boolean }).available
      } catch {
        createCardTaken.value = false
      } finally {
        createCardChecking.value = false
      }
    }, 320)
  },
)

watch(
  () => editState.form.value.cardNumber,
  (value) => {
    const candidate = value.trim()
    editCardTaken.value = false
  editLockerTaken.value = false
  editLockerChecking.value = false
    if (editCardTimer) clearTimeout(editCardTimer)
    if (!candidate) {
      editCardChecking.value = false
      return
    }
    editCardTimer = setTimeout(async () => {
      editCardChecking.value = true
      try {
        const { data } = await api.get('/clients/validate-card', {
          params: { cardNumber: candidate, excludeId: editingId.value || undefined },
        })
        editCardTaken.value = !(data as { available: boolean }).available
      } catch {
        editCardTaken.value = false
  editLockerTaken.value = false
  editLockerChecking.value = false
      } finally {
        editCardChecking.value = false
      }
    }, 320)
  },
)

watch(
  () => editState.form.value.lockerNumber,
  (value) => {
    const candidate = sanitizeLockerDigits(value)
    editLockerTaken.value = false
    if (editLockerTimer) clearTimeout(editLockerTimer)
    if (!candidate) {
      editLockerChecking.value = false
      return
    }
    const status = editState.form.value.status
    if (status !== 'ACTIVE' && status !== 'PAUSED') {
      editLockerChecking.value = false
      return
    }
    editLockerTimer = setTimeout(async () => {
      editLockerChecking.value = true
      try {
        const { data } = await api.get('/clients/validate-locker', {
          params: { lockerNumber: candidate, excludeId: editingId.value || undefined },
        })
        editLockerTaken.value = !(data as { available: boolean }).available
      } catch {
        editLockerTaken.value = false
      } finally {
        editLockerChecking.value = false
      }
    }, 320)
  },
)

watch(
  () => [createState.form.value.membershipType, createState.form.value.contractStartDate, memberships.value.length],
  () => {
    syncEndDateByMembership(createState.form.value)
  },
)

watch(
  () => [editState.form.value.membershipType, editState.form.value.contractStartDate, memberships.value.length],
  () => {
    syncEndDateByMembership(editState.form.value)
  },
)

function handleCreateHotkeys(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void createClient()
  }
}

function handleEditHotkeys(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void updateClient()
  }
}

function formatDateIso(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toIsoDate(value: unknown) {
  return pickerValueToIsoYmd(value)
}

function isoToDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

function onClientsLastVisitDateChange() {
  page.value = 1
}

const ageRangeValue = ref<[number, number]>([18, 99])

function normalizeAgeRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const left = Math.min(Math.max(Math.trunc(Number(value[0])), 18), 99)
  const right = Math.min(Math.max(Math.trunc(Number(value[1])), 18), 99)
  return left <= right ? [left, right] : [right, left]
}

function commitAgeRange(value: unknown) {
  const normalized = normalizeAgeRange(value)
  if (!normalized) return
  const [from, to] = normalized
  ageRangeValue.value = normalized
  if ((filters.value.ageFrom || '') === String(from) && (filters.value.ageTo || '') === String(to)) return
  patchFilters({ ageFrom: String(from), ageTo: String(to) })
}

function dateMinusDaysIso(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - Math.max(0, days - 1))
  return {
    from: formatDateIso(start),
    to: formatDateIso(end),
  }
}

type VisitPreset = 'TODAY' | '7D' | '30D'
type AgePreset = '18_25' | '26_35' | '36_PLUS'

const activeVisitPreset = computed<VisitPreset | null>(() => {
  const from = filters.value.lastVisitFrom || ''
  const to = filters.value.lastVisitTo || ''
  if (!from || !to) return null
  const today = dateMinusDaysIso(1)
  const d7 = dateMinusDaysIso(7)
  const d30 = dateMinusDaysIso(30)
  if (from === today.from && to === today.to) return 'TODAY'
  if (from === d7.from && to === d7.to) return '7D'
  if (from === d30.from && to === d30.to) return '30D'
  return null
})

const activeAgePreset = computed<AgePreset | null>(() => {
  const from = filters.value.ageFrom || ''
  const to = filters.value.ageTo || ''
  if (from === '18' && to === '25') return '18_25'
  if (from === '26' && to === '35') return '26_35'
  if (from === '36' && to === '99') return '36_PLUS'
  return null
})

function applyVisitPreset(preset: VisitPreset) {
  const range = preset === 'TODAY' ? dateMinusDaysIso(1) : preset === '7D' ? dateMinusDaysIso(7) : dateMinusDaysIso(30)
  patchFilters({ lastVisitFrom: range.from, lastVisitTo: range.to })
}

function applyAgePreset(preset: AgePreset) {
  if (preset === '18_25') {
    ageRangeValue.value = [18, 25]
    patchFilters({ ageFrom: '18', ageTo: '25' })
    return
  }
  if (preset === '26_35') {
    ageRangeValue.value = [26, 35]
    patchFilters({ ageFrom: '26', ageTo: '35' })
    return
  }
  ageRangeValue.value = [36, 99]
  patchFilters({ ageFrom: '36', ageTo: '99' })
}

const freezeTargetContract = computed(() =>
  editContractsHistory.value.find((item) => item.id === freezeTargetId.value) ?? null,
)

function parseDateIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

function calculateEndDate(
  startDateIso: string,
  durationValue: number | null,
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null,
) {
  const start = parseDateIso(startDateIso)
  if (!start || !durationValue || !durationUnit) return ''
  const end = new Date(start)
  if (durationUnit === 'DAY') {
    end.setDate(end.getDate() + durationValue)
  } else if (durationUnit === 'WEEK') {
    end.setDate(end.getDate() + durationValue * 7)
  } else if (durationUnit === 'MONTH') {
    const anchorDay = start.getDate()
    end.setDate(1)
    end.setMonth(end.getMonth() + durationValue)
    const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()
    end.setDate(Math.min(anchorDay, lastDay))
  } else {
    end.setTime(start.getTime())
  }
  return formatDateIso(end)
}

function syncEndDateByMembership(form: ClientForm) {
  if (!form.membershipType || !form.contractStartDate) {
    form.contractEndDate = ''
    return
  }
  const selected = memberships.value.find((m) => m.value === form.membershipType)
  const next = selected
    ? calculateEndDate(form.contractStartDate, selected.durationValue, selected.durationUnit)
    : ''
  if (form.contractEndDate !== next) form.contractEndDate = next
}

async function loadMemberships() {
  memberships.value = await fetchActiveMembershipCatalogOptions()
}

watch(
  () => ui.scannerTargetClientId,
  (id) => {
    if (!id) return
    void openScannerTargetClient(id)
  },
  { immediate: true },
)

watch(
  () => ui.clientsTableRefreshTick,
  () => {
    void clientsSource.reload(true)
  },
)

watch(
  () => ui.visitsTableRefreshTick,
  () => {
    const clientId = editingId.value
    if (!clientId) return
    void loadEditVisitsHistory(clientId)
  },
)

void (async () => {
  managers.value = await fetchManagerOptions()
  await loadMemberships()
})()

watch(
  () => [filters.value.ageFrom, filters.value.ageTo],
  ([fromRaw, toRaw]) => {
    const from = Number(fromRaw || 18)
    const to = Number(toRaw || 99)
    const safeFrom = Number.isFinite(from) ? Math.min(Math.max(Math.trunc(from), 18), 99) : 18
    const safeTo = Number.isFinite(to) ? Math.min(Math.max(Math.trunc(to), 18), 99) : 99
    ageRangeValue.value = safeFrom <= safeTo ? [safeFrom, safeTo] : [safeTo, safeFrom]
  },
  { immediate: true },
)

</script>

<template>
  <div class="clients-view">
    <AppPageCard :title="t('clients.title')">
      <template #actions>
        <VaButton preset="secondary" :disabled="loading" icon="refresh" @click="clientsSource.reload(true)">
          {{ t('common.refresh') }}
        </VaButton>
        <AppExportMenu :disabled="!total || loading" :loading="exportLoading" @export="exportClientsTable" />
        <VaButton color="primary" :disabled="loading" icon="add" @click="openCreate">
          {{ t('clients.add') }}
        </VaButton>
      </template>
      <template #filters>
        <div class="clients-filter-bar">
          <AppListFiltersToolbar>
            <div class="clients-filters-grid">
              <VaInput
                :model-value="search"
                :label="t('clients.searchLabel')"
                :placeholder="t('clients.searchPlaceholder')"
                class="cf-search toolbar-search"
                icon="search"
                @update:model-value="(v) => (search = typeof v === 'string' ? v : '')"
                @keyup.enter="applySearchNow"
              />
              <VaSelect
                :model-value="filters.membershipType || ALL_MEMBERSHIP_VALUE"
                :label="t('clients.filterMembership')"
                :options="membershipFilterOptions"
                value-by="value"
                text-by="text"
                class="cf-mship toolbar-select"
                @update:model-value="onMembershipFilter"
              />
              <VaSelect
                :model-value="filters.status || ALL_STATUS_VALUE"
                :label="t('clients.filterStatus')"
                :options="statusFilterSelectOptions"
                value-by="value"
                text-by="text"
                class="cf-status toolbar-select"
                @update:model-value="onStatusFilter"
              />
              <VaSelect
                :model-value="filters.inGym || ALL_GYM_VALUE"
                :label="t('clients.filterInGym')"
                :options="inGymFilterOptions"
                value-by="value"
                text-by="text"
                class="cf-ingym toolbar-select"
                @update:model-value="onInGymFilter"
              />
              <VaSelect
                :model-value="filters.gender || ALL_GENDER_VALUE"
                :label="t('clients.filterGender')"
                :options="genderFilterOptions"
                value-by="value"
                text-by="text"
                class="cf-gender toolbar-select"
                @update:model-value="onGenderFilter"
              />
              <AppDateRangeFilter
                v-model:from="filters.lastVisitFrom"
                v-model:to="filters.lastVisitTo"
                :label="t('clients.lastVisitRange')"
                :day-placeholder="t('clients.lastVisitDayPlaceholder')"
                :range-placeholder="t('clients.lastVisitRangePlaceholder')"
                input-class="app-date-range-filter__input toolbar-select toolbar-range"
                class="cf-visit"
                @change="onClientsLastVisitDateChange"
                @cleared="onClientsLastVisitDateChange"
              />
              <div class="cf-age toolbar-select toolbar-age-slider">
                <div class="age-slider__head">
                  <span class="age-slider__label">{{ t('clients.filterAgeRange') }}</span>
                  <span class="age-slider__value">{{ ageRangeValue[0] }}-{{ ageRangeValue[1] }}</span>
                </div>
                <VaSlider
                  v-model="ageRangeValue"
                  range
                  :min="18"
                  :max="99"
                  :step="1"
                  color="primary"
                  @change="commitAgeRange"
                  @drag-end="commitAgeRange"
                />
              </div>
              <VaButton
                type="button"
                preset="secondary"
                size="small"
                class="cf-reset clients-filters-reset"
                icon="restart_alt"
                :disabled="!hasToolbarReset"
                @click="resetToolbar"
              >
                {{ t('common.reset') }}
              </VaButton>
            </div>
          </AppListFiltersToolbar>
        </div>
      </template>

      <div class="clients-presets-row">
        <div class="app-preset-strip preset-strip--age" :class="{ 'app-preset-strip--active': Boolean(activeAgePreset) }">
          <VaIcon name="person" size="16px" color="secondary" />
          <span class="app-preset-label">{{ t('clients.agePresets') }}</span>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeAgePreset === '18_25' ? 'primary' : 'secondary'"
            @click="applyAgePreset('18_25')"
          >
            18-25
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeAgePreset === '26_35' ? 'primary' : 'secondary'"
            @click="applyAgePreset('26_35')"
          >
            26-35
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeAgePreset === '36_PLUS' ? 'primary' : 'secondary'"
            @click="applyAgePreset('36_PLUS')"
          >
            36+
          </VaButton>
        </div>
        <div class="app-preset-strip preset-strip--visit" :class="{ 'app-preset-strip--active': Boolean(activeVisitPreset) }">
          <VaIcon name="event" size="16px" color="secondary" />
          <span class="app-preset-label">{{ t('clients.visitPresets') }}</span>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeVisitPreset === 'TODAY' ? 'primary' : 'secondary'"
            @click="applyVisitPreset('TODAY')"
          >
            {{ t('clients.presetToday') }}
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeVisitPreset === '7D' ? 'primary' : 'secondary'"
            @click="applyVisitPreset('7D')"
          >
            {{ t('clients.preset7Days') }}
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeVisitPreset === '30D' ? 'primary' : 'secondary'"
            @click="applyVisitPreset('30D')"
          >
            {{ t('clients.preset30Days') }}
          </VaButton>
        </div>
      </div>

      <AppDataTableShell :loading="loading" :has-items="hasClients" :show-pager="hasClients && pages > 1">
        <div class="clients-table-scroll" @scroll.passive="closeClientRowActionsMenu">
          <VaDataTable
            class="clients-data-table app-table-actions-last-col"
            clickable
            hoverable
            :items="tableItems"
            :columns="columns"
            :sort-by="sortBy ?? undefined"
            :sorting-order="sortOrder ?? undefined"
            disable-client-side-sorting
            @update:sort-by="handleSortByUpdate"
            @update:sorting-order="handleSortOrderUpdate"
            @row:click="handleClientsTableRowClick"
          >
          <template #cell(photo)="{ rowData }">
            <div class="photo-cell">
              <img v-if="rowData.avatarUrl" :src="rowData.avatarUrl" alt="" class="photo-cell__img" />
              <div v-else class="photo-cell__placeholder">
                <VaIcon name="person" size="16px" />
              </div>
            </div>
          </template>
          <template #cell(contractDaysLeft)="{ rowData }">
            <div class="clients-contract-days-cell">
              <span
                class="clients-contract-days"
                :class="
                  rowData.contractDaysTone === 'neutral'
                    ? 'clients-contract-days--neutral'
                    : `clients-contract-days--${rowData.contractDaysTone}`
                "
              >
                {{ rowData.contractDaysText }}
              </span>
            </div>
          </template>
          <template #cell(status)="{ rowData }">
            <StatusBadge :label="t(`clients.status.${rowData.status}`)" :tone="statusColor(rowData.status)" />
          </template>
          <template #cell(inGym)="{ rowData }">
            <button
              type="button"
              class="clients-gym-chip-trigger"
              :title="rowData.gymChipTitle"
              @click.stop="openScannerFromGymChip(rowData)"
            >
              <StatusBadge :label="rowData.gymChipLabel" :tone="rowData.gymChipTone" />
            </button>
          </template>
          <template #cell(age)="{ rowData }">
            {{ rowData.age ?? '—' }}
          </template>
          <template #cell(gender)="{ rowData }">
            {{ rowData.gender ? t(`clients.gender.${rowData.gender}`) : t('clients.genderEmpty') }}
          </template>
          <template #cell(lastVisitAt)="{ rowData }">
            {{ rowData.lastVisitAt ? new Date(rowData.lastVisitAt).toLocaleString('ru-RU') : '—' }}
          </template>
          <template #cell(actions)="{ rowData }">
            <div class="clients-table-actions-cell">
              <div class="clients-row-menu">
                <button
                  type="button"
                  class="clients-row-menu__trigger"
                  :aria-label="t('clients.actionsMenu')"
                  :aria-expanded="clientsRowMenuOpenId === rowData.id ? 'true' : 'false'"
                  @click.stop="onRowMenuTriggerClick(rowData, $event)"
                >
                  <VaIcon name="more_vert" size="22px" />
                </button>
              </div>
            </div>
          </template>
        </VaDataTable>
        </div>
        <template #empty>
          <AppEmptyState
            icon="person_search"
            :title="t('clients.emptyTitle')"
            :description="t('clients.emptyDesc')"
            :action-label="t('clients.add')"
            action-icon="add"
            @action="openCreate"
          />
        </template>
        <template #pager>
          <AppTablePagerRow
            :limit="limit"
            :page="page"
            :pages="pages"
            :disabled="loading"
            @update:limit="(v) => (limit = v)"
            @update:page="(v) => (page = v)"
          />
        </template>
      </AppDataTableShell>
    </AppPageCard>

    <Teleport to="body">
      <div
        v-if="clientsRowMenuRow"
        class="clients-row-menu-layer"
        :style="clientsRowMenuLayerStyle"
        @click.stop
      >
        <div class="clients-row-menu__panel">
          <ul class="clients-row-menu__list" role="menu">
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="clients-row-menu__item"
                @click="runRowMenuAction(clientsRowMenuRow!, (r) => openEdit(r))"
              >
                <VaIcon :name="TableActionIcon.edit" size="18px" />
                {{ t('clients.edit') }}
              </button>
            </li>
            <li v-if="clientRowShowsGenerateContract(clientsRowMenuRow!)" role="none">
              <button
                type="button"
                role="menuitem"
                class="clients-row-menu__item"
                :disabled="
                  contractGenerateLoadingId === clientsRowMenuRow!.id ||
                  statusActionLoadingId === clientsRowMenuRow!.id
                "
                @click="runRowMenuAction(clientsRowMenuRow!, (r) => void generateContractFromTableRow(r))"
              >
                <VaIcon
                  :name="TableActionIcon.generateContract"
                  size="18px"
                  :class="{ 'clients-row-menu__icon--spin': contractGenerateLoadingId === clientsRowMenuRow!.id }"
                />
                {{ t('clients.generateContract') }}
              </button>
            </li>
            <li v-if="canBlockOrDeleteClient && clientsRowMenuRow!.status !== 'BLOCKED'" role="none">
              <button
                type="button"
                role="menuitem"
                class="clients-row-menu__item clients-row-menu__item--warning"
                :disabled="statusActionLoadingId === clientsRowMenuRow!.id"
                @click="runRowMenuAction(clientsRowMenuRow!, (r) => blockClient(r))"
              >
                <VaIcon :name="TableActionIcon.blockClient" size="18px" />
                {{ t('clients.block') }}
              </button>
            </li>
            <li v-else-if="canBlockOrDeleteClient && clientsRowMenuRow!.status === 'BLOCKED'" role="none">
              <button
                type="button"
                role="menuitem"
                class="clients-row-menu__item"
                :disabled="statusActionLoadingId === clientsRowMenuRow!.id"
                @click="runRowMenuAction(clientsRowMenuRow!, (r) => unblockClient(r))"
              >
                <VaIcon :name="TableActionIcon.unblockClient" size="18px" />
                {{ t('clients.unblock') }}
              </button>
            </li>
            <li v-if="canBlockOrDeleteClient" role="none">
              <button
                type="button"
                role="menuitem"
                class="clients-row-menu__item clients-row-menu__item--danger"
                @click="runRowMenuAction(clientsRowMenuRow!, (r) => askDelete(r))"
              >
                <VaIcon :name="TableActionIcon.delete" size="18px" />
                {{ t('clients.delete') }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>

    <VaModal
      class="clients-editor-modal"
      :model-value="createState.open.value"
      hide-default-actions
      fixed-layout
      :mobile-fullscreen="false"
      max-width="min(calc(100vw - 12px), 900px)"
      @update:model-value="(v) => (v ? (createState.open.value = true) : requestCloseCreate())"
    >
      <template #header />
      <form class="app-modal-form" @submit.prevent="createClient" @keydown="handleCreateHotkeys">
        <AppSectionCard :title="t('clients.createTitle')" class="client-editor-card">
          <ClientFormFields
            ref="createFormRef"
            v-model="createState.form.value"
            :is-create-mode="true"
            :attempted="createAttempted"
            :status-options="editorStatusOptions"
            :membership-options="membershipOptions"
            :card-number-checking="createCardChecking"
            :card-number-taken="createCardTaken"
            @generate-contract-number="regenerateCreateContractNumber"
            @photo-draft-changed="onCreatePhotoDraftChanged"
          />
        </AppSectionCard>
        <div class="app-modal-actions clients-modal-actions">
          <div class="clients-modal-actions__end clients-modal-actions__end--only">
            <VaButton
              type="button"
              preset="secondary"
              icon="close"
              :aria-label="t('common.cancel')"
              :disabled="createState.loading.value"
              @click="requestCloseCreate"
            >
              <span class="clients-modal-action-label">{{ t('common.cancel') }}</span>
            </VaButton>
            <VaButton
              type="submit"
              icon="save"
              :loading="createState.loading.value"
              :aria-label="t('users.save')"
            >
              <span class="clients-modal-action-label">{{ t('users.save') }}</span>
            </VaButton>
          </div>
        </div>
        <div
          v-if="createModalErrorText"
          class="app-modal-form-errors app-form-error-banner"
          role="alert"
        >
          {{ createModalErrorText }}
        </div>
      </form>
    </VaModal>

    <VaModal
      class="clients-editor-modal"
      :model-value="editModalOpen"
      hide-default-actions
      :mobile-fullscreen="false"
      max-width="min(calc(100vw - 12px), 900px)"
      @update:model-value="onEditModalVisibilityChange"
    >
      <template #header />
      <form
        class="app-modal-form app-modal-form--client-edit"
        @submit.prevent="updateClient"
        @keydown="handleEditHotkeys"
      >
        <div class="client-edit-modal-scroll">
        <AppSectionCard class="client-editor-card">
          <div class="person-header">
            <div class="person-headline-wrap">
              <div class="person-headline">{{ editHeaderSnapshot.headline }}</div>
            </div>
            <div class="person-header__end">
              <div class="person-status-wrap">
                <StatusBadge :label="statusLabel(editHeaderSnapshot.status)" :tone="statusColor(editHeaderSnapshot.status)" />
                <StatusBadge v-if="editGymChip" :label="editGymChip.label" :tone="editGymChip.tone" />
                <span v-if="editPauseUntilCompactLabel" class="person-status-note">{{ editPauseUntilCompactLabel }}</span>
              </div>
              <button
                type="button"
                class="person-header__close"
                :disabled="editState.loading.value"
                :aria-label="t('common.cancel')"
                @click="requestCloseEdit"
              >
                <VaIcon name="close" size="22px" />
              </button>
            </div>
          </div>
          <ClientFormFields
            ref="editFormRef"
            v-model="editState.form.value"
            v-model:active-tab="editClientTab"
            :photo-upload-client-id="editingId"
            :is-create-mode="false"
            :attempted="editAttempted"
            :status-options="editorStatusOptions"
            :membership-options="membershipOptionsForEdit"
            :card-number-checking="editCardChecking"
            :card-number-taken="editCardTaken"
            :locker-number-checking="editLockerChecking"
            :locker-number-taken="editLockerTaken"
            :contract-history="editContractsHistory"
            :contract-history-loading="editContractsLoading"
            :payments-history="editPaymentsHistory"
            :payments-loading="editPaymentsLoading"
            :visits-history="editVisitsHistory"
            :visits-loading="editVisitsLoading"
            :visits-page="editVisitsPage"
            :visits-limit="editVisitsLimit"
            :visits-total="editVisitsTotal"
            :visits-from="editVisitsFrom"
            :visits-to="editVisitsTo"
            :adding-contract-payment="addContractPaymentLoading"
            @generate-contract-number="regenerateEditContractNumber"
            @open-contract-history-item="openContractFromHistory"
            @activate-contract-history-item="openActivateContractFromHistory"
            @pause-contract-history-item="pauseContractFromHistory"
            @resume-contract-history-item="askResumeContractFromHistory"
            @terminate-contract-history-item="terminateContractFromHistory"
            @add-contract-payment="onAddContractPayment"
            @visits-tab-open="onEditVisitsTabOpen"
            @update:visits-page="onEditVisitsPageChange"
            @update:visits-limit="onEditVisitsLimitChange"
            @update:visits-from="onEditVisitsFromChange"
            @update:visits-to="onEditVisitsToChange"
            @visits-reset-filters="onEditVisitsResetFilters"
            @photo-draft-changed="onEditPhotoDraftChanged"
          />
        </AppSectionCard>
        </div>
        <div class="app-modal-actions clients-modal-actions">
          <div class="clients-modal-actions__start">
            <VaButton
              type="button"
              preset="secondary"
              :icon="TableActionIcon.viewDocument"
              :aria-label="t('clients.generateContract')"
              :disabled="editState.loading.value || !editingId || editClientBlocked"
              :title="editClientBlocked ? t('clients.blockedCannotGenerateContract') : ''"
              @click="generateContractForEditingClient"
            >
              <span class="clients-modal-action-label">{{ t('clients.generateContract') }}</span>
            </VaButton>
          </div>
          <div class="clients-modal-actions__end">
            <VaButton
              type="button"
              preset="secondary"
              icon="close"
              :aria-label="t('common.cancel')"
              :disabled="editState.loading.value"
              @click="requestCloseEdit"
            >
              <span class="clients-modal-action-label">{{ t('common.cancel') }}</span>
            </VaButton>
            <VaButton
              type="submit"
              icon="save"
              :loading="editState.loading.value"
              :aria-label="t('users.save')"
            >
              <span class="clients-modal-action-label">{{ t('users.save') }}</span>
            </VaButton>
          </div>
        </div>
        <div
          v-if="editModalErrorText"
          class="app-modal-form-errors app-form-error-banner"
          role="alert"
        >
          {{ editModalErrorText }}
        </div>
      </form>
    </VaModal>

    <ConfirmModal
      v-model="blockOpen"
      :title="t('clients.blockTitle')"
      :message="t('clients.blockConfirm', { name: blockTarget?.name ?? '' })"
      :confirm-label="t('clients.block')"
      :cancel-label="t('common.cancel')"
      :loading="statusActionLoadingId === blockTarget?.id"
      danger
      @confirm="confirmBlockClient"
    />

    <ConfirmModal
      v-model="deleteOpen"
      :title="t('clients.deleteTitle')"
      :message="t('clients.deleteConfirm', { name: deletingClient?.name ?? '' })"
      :confirm-label="t('clients.delete')"
      :cancel-label="t('common.cancel')"
      :loading="deleteLoading"
      :error="deleteError"
      danger
      @confirm="deleteClient"
    />

    <ConfirmModal
      v-model="unblockOpen"
      :title="t('clients.unblockTitle')"
      :message="t('clients.unblockConfirm', { name: unblockTarget?.name ?? '' })"
      :confirm-label="t('clients.unblock')"
      :cancel-label="t('common.cancel')"
      :loading="statusActionLoadingId === unblockTarget?.id"
      @confirm="confirmUnblockClient"
    />

    <ConfirmModal
      v-model="discardOpen"
      :title="t('clients.unsavedTitle')"
      :message="t('clients.unsavedMessage')"
      :confirm-label="t('clients.discardChanges')"
      :cancel-label="t('common.cancel')"
      @confirm="discardChanges"
    />

    <ConfirmModal
      v-model="generateConfirmOpen"
      :title="t('clients.saveBeforeGenerateTitle')"
      :message="t('clients.saveBeforeGenerateMessage')"
      :confirm-label="t('users.save')"
      :cancel-label="t('common.cancel')"
      :loading="editState.loading.value"
      @confirm="saveAndGenerateContract"
    />

    <VaModal v-model="activateOpen" hide-default-actions fixed-layout max-width="520px">
      <h3 class="modal-title">{{ t('clients.activateContractTitle') }}</h3>
      <p class="modal-hint">{{ t('clients.activateContractHint') }}</p>
      <div class="modal-grid">
        <VaDateInput
          :model-value="isoToDate(activateForm.serviceStartDate) || undefined"
          :label="t('contracts.serviceStartDate')"
          class="modal-grid__full"
          @update:model-value="activateForm.serviceStartDate = toIsoDate($event)"
        />
        <VaDateInput
          :model-value="isoToDate(activateForm.serviceEndDate) || undefined"
          :label="t('contracts.serviceEndDate')"
          class="modal-grid__full"
          readonly
        />
        <VaAlert v-if="activateUiError" color="danger" outline class="modal-grid__full">
          {{ activateUiError }}
        </VaAlert>
      </div>
      <div class="app-modal-actions">
        <VaButton preset="secondary" @click="activateOpen = false">{{ t('common.cancel') }}</VaButton>
        <VaButton :loading="activateLoading" @click="submitActivateFromHistory">
          {{ t('clients.activateContract') }}
        </VaButton>
      </div>
    </VaModal>

    <ContractFreezeModal
      v-model="freezeOpen"
      :loading="freezeLoading"
      :error="freezeUiError"
      :contract-number="freezeTargetContract?.contractNumber"
      :service-start-date="freezeTargetContract?.serviceStartDate"
      :service-end-date="freezeTargetContract?.serviceEndDate"
      @submit="submitFreezeFromHistory"
    />

    <ContractResumeModal
      v-model="resumeOpen"
      :contract-id="resumeTargetId"
      :loading="resumeLoading"
      :submit-error="resumeUiError"
      @submit="submitResumeFromHistory"
    />

    <VaModal v-model="cancelOpen" hide-default-actions fixed-layout max-width="520px">
      <h3 class="modal-title">{{ t('contracts.cancelRefundTitle') }}</h3>
      <div class="modal-grid">
        <VaInput v-model="cancelForm.refundAmount" :label="t('contracts.refundAmount')" class="modal-grid__full" />
        <VaSelect
          v-model="cancelForm.refundMethod"
          :label="t('contracts.refundMethod')"
          :options="[
            { value: 'CASH', text: t('contracts.refundMethodCash') },
            { value: 'CARD', text: t('contracts.refundMethodCard') },
            { value: 'TRANSFER', text: t('contracts.refundMethodTransfer') },
          ]"
          value-by="value"
          text-by="text"
          class="modal-grid__full"
        />
        <VaInput v-model="cancelForm.comment" :label="t('contracts.refundComment')" class="modal-grid__full" />
      </div>
      <div class="app-modal-actions">
        <VaButton preset="secondary" @click="cancelOpen = false">{{ t('common.cancel') }}</VaButton>
        <VaButton color="warning" :loading="cancelLoading" @click="submitCancelFromHistory">{{ t('contracts.terminate') }}</VaButton>
      </div>
    </VaModal>

  </div>
</template>

<style scoped>
.clients-view {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.clients-filter-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  overflow: visible;
}
.clients-filters-grid {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) repeat(3, minmax(0, 1fr)) minmax(5.5rem, auto);
  grid-template-areas:
    'search mship status ingym gender'
    'visit age age ingym reset';
  gap: 0.45rem 0.5rem;
  align-items: stretch;
}
.clients-filters-grid > .cf-search,
.clients-filters-grid > .cf-visit,
.clients-filters-grid > .cf-mship,
.clients-filters-grid > .cf-status,
.clients-filters-grid > .cf-ingym,
.clients-filters-grid > .cf-gender,
.clients-filters-grid > .cf-age,
.clients-filters-grid > .cf-reset {
  width: 100%;
  min-width: 0;
  max-width: none;
}
.cf-search {
  grid-area: search;
  min-width: 0;
}
.cf-mship {
  grid-area: mship;
  min-width: 0;
}
.cf-status {
  grid-area: status;
  min-width: 0;
}
.cf-ingym {
  grid-area: ingym;
  min-width: 0;
}
.cf-gender {
  grid-area: gender;
  min-width: 0;
}
.cf-age {
  grid-area: age;
  align-self: end;
}
.cf-visit {
  grid-area: visit;
  align-self: end;
}
.cf-reset {
  grid-area: reset;
  justify-self: stretch;
  align-self: stretch;
}
.clients-filters-grid .toolbar-select,
.clients-filters-grid .toolbar-search {
  max-width: none;
  width: 100%;
  flex: unset;
}
.clients-filters-reset {
  flex: 0 0 auto;
  white-space: nowrap;
}
.clients-presets-row {
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
.toolbar-select {
  --va-input-wrapper-width: 100%;
  flex: 1 1 12rem;
  min-width: 0;
  max-width: 15rem;
}
.clients-filters-grid .toolbar-select {
  min-width: 0;
  max-width: none;
}
.toolbar-date {
  flex-basis: 11.5rem;
  min-width: 11.5rem;
  max-width: 13.5rem;
}
.toolbar-age-slider {
  min-width: 0;
  max-width: none;
  width: 100%;
  padding: 0.15rem 0.35rem 0.15rem 0.25rem;
  min-height: 2.85rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
}
.age-slider__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}
.age-slider__label {
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  line-height: 1.35;
  font-weight: 600;
  color: var(--app-muted);
}
.age-slider__value {
  font-size: 0.8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--app-text) 88%, var(--app-muted));
}
.toolbar-range {
  min-width: 0;
  max-width: none;
}
.toolbar-search {
  --va-input-wrapper-width: 100%;
  flex: 2 1 24rem;
  min-width: 0;
  max-width: 38rem;
}
.clients-filters-grid .toolbar-search {
  min-width: 0;
  max-width: none;
}
.preset-strip--age {
  flex: 1 1 18rem;
  min-width: 18rem;
}
.preset-strip--visit {
  flex: 1 1 18rem;
  min-width: 18rem;
}
.clients-filter-bar :deep(.va-input-wrapper__field),
.clients-filter-bar :deep(.va-select__anchor),
.clients-filter-bar :deep(.va-date-input .va-input-wrapper__field) {
  min-height: var(--app-control-height);
}
.clients-filter-bar :deep(.va-slider) {
  --va-slider-track-height: 0.28rem;
  --va-slider-handler-size: 0.92rem;
  width: 100%;
  margin-top: 0.15rem;
}
.clients-filter-bar :deep(.va-slider__container) {
  min-height: 1.4rem;
}
.clients-filter-bar :deep(.va-slider__track) {
  opacity: 1 !important;
}
.clients-filter-bar :deep(.va-slider__handler) {
  opacity: 1 !important;
}
.clients-filter-bar :deep(.va-input-wrapper__container) {
  border-radius: 8px;
}
.clients-filter-bar :deep(.va-input-wrapper) {
  background: transparent !important;
}
.clients-filter-bar :deep(.va-input-wrapper__field::after) {
  background: color-mix(in srgb, var(--app-surface) 97%, white 3%) !important;
  opacity: 1 !important;
}
.clients-filter-bar :deep(.va-input-label) {
  background: transparent !important;
  box-shadow: none !important;
}
.clients-filter-bar :deep(.va-select),
.clients-filter-bar :deep(.va-date-input) {
  background: transparent;
  width: 100%;
  max-width: none;
}

.clients-filter-bar :deep(.va-input-wrapper) {
  width: 100%;
  max-width: none;
}
.clients-filter-bar :deep(.va-button) {
  min-height: var(--app-control-height);
}
.photo-cell {
  display: flex;
  align-items: center;
  width: 100%;
  justify-content: center;
}
.photo-cell :deep(img) {
  display: block;
}
.toolbar-search :deep(input)::placeholder {
  text-transform: none;
}
.photo-cell__img {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--app-border);
}
.photo-cell__placeholder {
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
/** Редактирование клиента: скролл только при реальном переполнении, без «пустого хвоста». */
.app-modal-form--client-edit {
  gap: 0.65rem;
  align-items: stretch;
}

.app-modal-form--client-edit :deep(.client-editor-card.section-card) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.client-edit-modal-scroll {
  --client-edit-scroll-max-height: calc(100vh - 10.5rem);
  --client-edit-scroll-max-height: calc(100dvh - 10.5rem);
  flex: 0 0 auto;
  align-self: stretch;
  width: 100%;
  height: fit-content;
  max-height: var(--client-edit-scroll-max-height);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--app-muted) 28%, transparent) transparent;
}

.client-edit-modal-scroll::-webkit-scrollbar {
  width: 9px;
}

.client-edit-modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.client-edit-modal-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-muted) 28%, transparent);
}

.person-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
  margin: -0.05rem 0 0.55rem;
  padding: 0.15rem 0.1rem 0.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
}
.person-headline-wrap {
  min-width: 0;
  display: grid;
  gap: 0.2rem;
}
.person-headline {
  font-size: 1.65rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--app-text) 88%, var(--app-muted));
  line-height: 1.15;
}
.person-header__end {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
  max-width: 58%;
}
.person-header__close {
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
.person-header__close:hover:not(:disabled) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-border) 14%);
}
.person-header__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}
.person-header__close:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.person-status-wrap {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.person-status-note {
  font-size: 0.82rem;
  color: var(--app-muted);
  white-space: nowrap;
  line-height: 1;
}

@media (max-width: 640px) {
  .person-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
    margin: 0 0 0.45rem;
    padding: 0 0 0.35rem;
  }

  .person-headline-wrap {
    max-width: 100%;
    min-width: 0;
  }

  .person-headline {
    font-size: 1.02rem;
    line-height: 1.28;
    word-break: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
  }

  .person-header__end {
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .person-status-wrap {
    max-width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .person-status-note {
    white-space: normal;
    flex: 1 1 100%;
    line-height: 1.3;
  }

  .client-edit-modal-scroll {
    --client-edit-scroll-max-height: calc(100dvh - 9rem);
  }
}
.modal-title {
  margin: 0 0 0.75rem;
  font-size: 1.04rem;
  font-weight: 700;
}
.modal-hint {
  margin: 0 0 0.85rem;
  font-size: 0.88rem;
  line-height: 1.4;
  color: var(--app-muted);
}
.modal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--app-section-gap);
}
.modal-grid__full {
  grid-column: 1 / -1;
}

.clients-gym-chip-trigger {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 999px;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.clients-gym-chip-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--va-primary) 55%, transparent);
  outline-offset: 2px;
}

.clients-gym-chip-trigger:hover:not(:disabled) {
  transform: translateY(-1px);
}

.clients-gym-chip-trigger:active:not(:disabled) {
  transform: translateY(0);
}

.clients-contract-days-cell {
  width: 100%;
  text-align: right;
}

.clients-contract-days {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.clients-contract-days--neutral {
  color: var(--app-muted);
  font-weight: 500;
}

.clients-contract-days--green {
  color: #4ade80;
}

.clients-contract-days--orange {
  color: #fb923c;
}

.clients-contract-days--yellow {
  color: #facc15;
}

.clients-contract-days--red {
  color: #f87171;
}

.clients-table-scroll {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

/* VaDataTable сам ставит overflow-x: auto — без этого два горизонтальных скролла */
.clients-table-scroll :deep(.va-data-table:not(.va-data-table--virtual-scroller)) {
  overflow: visible;
}

.clients-data-table {
  min-width: 72rem;
}

.clients-data-table.app-table-actions-last-col :deep(thead th:last-child),
.clients-data-table.app-table-actions-last-col :deep(tbody td:last-child) {
  text-align: right;
}

.clients-table-actions-cell {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.clients-modal-actions {
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.15rem;
  padding: 0.75rem 0.85rem 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface)) 0%,
    var(--app-surface) 100%
  );
}

.clients-modal-actions__start,
.clients-modal-actions__end {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.clients-modal-actions__end {
  margin-left: auto;
}

.clients-modal-actions__end--only {
  width: 100%;
  justify-content: flex-end;
}

.clients-modal-actions__start :deep(.va-button),
.clients-modal-actions__end :deep(.va-button) {
  min-width: 7.5rem;
}

.clients-modal-actions__end :deep(.va-button[type='submit']) {
  min-width: 8.5rem;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--app-accent) 24%, transparent);
}

.clients-row-menu {
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
}

.clients-row-menu__trigger {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--va-primary);
}

.clients-row-menu__trigger:hover {
  background: color-mix(in srgb, var(--app-surface) 86%, var(--va-primary) 14%);
}

.clients-row-menu-layer {
  box-sizing: border-box;
  min-width: 12.5rem;
}

.clients-row-menu-layer .clients-row-menu__panel {
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-soft);
}

.clients-row-menu__list {
  margin: 0;
  padding: 0.3rem;
  min-width: 12.5rem;
  list-style: none;
}

.clients-row-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.55rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--app-text);
}

.clients-row-menu__item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--app-surface) 82%, var(--app-border) 18%);
}

.clients-row-menu__item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.clients-row-menu__item--warning {
  color: var(--va-warning);
}

.clients-row-menu__item--danger {
  color: var(--va-danger);
}

.clients-row-menu__icon--spin {
  animation: clients-menu-spin 0.85s linear infinite;
}

@keyframes clients-menu-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 1201px) {
  .cf-reset {
    justify-self: stretch;
    align-self: end;
  }
}

@media (max-width: 1200px) {
  /* Одна колонка на планшетах и телефонах — иначе селекты с max-width ломают сетку. */
  .clients-filters-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'search'
      'mship'
      'status'
      'ingym'
      'gender'
      'visit'
      'age'
      'reset';
    gap: 0.55rem 0;
    align-items: stretch;
  }

  .cf-reset {
    justify-self: stretch;
    align-self: stretch;
  }

  .cf-age {
    max-width: none;
    justify-self: stretch;
    align-self: stretch;
  }

  .cf-visit {
    align-self: stretch;
  }

  .clients-filters-reset {
    width: 100%;
  }

  .toolbar-age-slider {
    max-width: none;
  }

  .clients-presets-row {
    flex-direction: column;
    align-items: stretch;
  }

  .preset-strip--age,
  .preset-strip--visit {
    min-width: 100%;
    flex-basis: 100%;
    flex-wrap: wrap;
    width: 100%;
  }
}

@media (max-width: 760px) {
  .clients-filter-bar {
    gap: 0.55rem;
    padding-bottom: 0.25rem;
  }

  .clients-filters-grid {
    gap: 0.65rem 0;
  }

  /* Единый вид подписей с селектами (в т.ч. возраст). */
  .clients-filter-bar :deep(.va-input-label) {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .clients-filter-bar .age-slider__label {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .clients-filter-bar .age-slider__value {
    font-size: 0.875rem;
    padding: 0.12rem 0.45rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--va-primary) 10%, var(--app-surface));
    color: var(--va-primary);
  }

  .toolbar-age-slider {
    padding: 0.45rem 0.55rem 0.55rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--app-border) 35%, transparent);
    min-height: auto;
  }

  .age-slider__head {
    margin-bottom: 0.35rem;
  }

  .clients-filter-bar :deep(.va-slider__handler) {
    width: 1.15rem !important;
    height: 1.15rem !important;
  }

  .clients-filter-bar :deep(.va-slider__container) {
    min-height: 1.65rem;
  }

  .cf-visit {
    overflow: visible;
  }

  .visit-date-filter__label {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .visit-date-filter__seg {
    min-width: 2.45rem;
    font-size: 0.72rem;
  }

  .clients-filter-bar :deep(.va-date-input) {
    width: 100%;
    max-width: none;
  }

  .clients-filter-bar :deep(.va-date-input .va-input-wrapper) {
    overflow: visible;
  }

  .clients-presets-row {
    padding-top: 0.55rem;
    padding-bottom: 0.15rem;
    gap: 0.55rem;
  }
}
</style>
