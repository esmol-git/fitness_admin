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
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import ClientFormFields from '@/components/clients/ClientFormFields.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { parseClientsListRouteQuery, useClientsListUrlSync } from '@/composables/useClientsListUrlSync'
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
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'
import { getClientContractDaysLeft } from '@/utils/clientContractRemaining'

const { t } = useI18n()
const { init: notify } = useToast()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const auth = useAuthStore()
const urlInit = parseClientsListRouteQuery(route.query)
const editClientId = ref(urlInit.editClientId)

const table = useTableState<
  ClientRow,
  {
    status?: ClientStatus | ''
    inGym?: 'IN_GYM' | 'OUT_GYM' | ''
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
  address: '',
  notes: '',
  contractNumber: '',
  contractStartDate: '',
  contractEndDate: '',
  paymentDate: '',
  membershipType: '',
  cardNumber: '',
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
  address: '',
  notes: '',
  contractNumber: '',
  contractStartDate: '',
  contractEndDate: '',
  paymentDate: '',
  membershipType: '',
  cardNumber: '',
  photoUrl: '',
}))

const createAttempted = ref(false)
const editAttempted = ref(false)
const editingId = ref<string | null>(null)
const editHeaderSnapshot = ref<{ headline: string; status: ClientStatus; inGym: boolean | null }>({
  headline: '—',
  status: 'INACTIVE',
  inGym: null,
})
const editPauseUntil = ref<string | null>(null)
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
const createFormRef = ref<{ focusFirstInvalid: () => void; validateSubmitFields: () => void } | null>(null)
const editFormRef = ref<{ focusFirstInvalid: () => void; validateSubmitFields: () => void } | null>(null)
const createCardChecking = ref(false)
const editCardChecking = ref(false)
const createCardTaken = ref(false)
const editCardTaken = ref(false)
const editContractsHistory = ref<
  Array<{
    id: string
    contractNumber: string
    status?: string
    servicePrice?: string | number | null
    serviceStartDate?: string | null
    serviceEndDate?: string | null
    pauseUntil?: string | null
    s3Url?: string | null
    createdAt: string
  }>
>([])
const editContractsLoading = ref(false)
const editPaymentsHistory = ref<
  Array<{
    id: string
    amount: string | number
    paidAt: string
    status: string
    comment?: string | null
    contractDocumentId?: string | null
  }>
>([])
const editPaymentsLoading = ref(false)
const editHistoryRequestId = ref(0)
const freezeOpen = ref(false)
const freezeLoading = ref(false)
const freezeTargetId = ref<string | null>(null)
const freezeMode = ref<'preset' | 'manual'>('preset')
const freezePreset = ref<7 | 14 | 30>(7)
const freezeForm = ref({ startDate: '', endDate: '', reason: '' })
const freezeUiError = ref<string | null>(null)
const cancelOpen = ref(false)
const cancelLoading = ref(false)
const cancelTarget = ref<{ id: string; contractNumber: string } | null>(null)
const cancelForm = ref({ refundAmount: '', refundMethod: 'CASH', comment: '' })
const statusActionLoadingId = ref<string | null>(null)
const contractGenerateLoadingId = ref<string | null>(null)
let createCardTimer: ReturnType<typeof setTimeout> | null = null
let editCardTimer: ReturnType<typeof setTimeout> | null = null

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

const createPersonHeadline = computed(() => getPersonHeadline(createState.form.value))
const createHeaderStatus = computed(() => createState.form.value.status)
const hasCurrentContractForEdit = computed(() =>
  editContractsHistory.value.some((item) => item.status === 'ACTIVE' || item.status === 'PAUSED'),
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
})

const onStatusFilter = createStringFilterHandler('status', (value) =>
  parseClientStatusFilterValue(value === ALL_STATUS_VALUE ? '' : value),
)
const onInGymFilter = createStringFilterHandler('inGym', (value) =>
  value === ALL_GYM_VALUE ? '' : value === 'IN_GYM' || value === 'OUT_GYM' || value === '' ? value : null,
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

const clientsSource = useTableDataSource<ClientRow, typeof query.value>({
  query,
  loading,
  setResult,
  fetcher: async (params) => {
    const safeParams: Record<string, string | number> = { page: params.page, limit: params.limit }
    const trimmedSearch = typeof params.search === 'string' ? params.search.trim() : ''
    if (trimmedSearch) safeParams.search = trimmedSearch
    if (
      params.status === 'ACTIVE' ||
      params.status === 'PAUSED' ||
      params.status === 'INACTIVE' ||
      params.status === 'BLOCKED'
    ) {
      safeParams.status = params.status
    }
    if (params.inGym === 'IN_GYM' || params.inGym === 'OUT_GYM') {
      safeParams.inGym = params.inGym
    }
    const membershipType = typeof params.membershipType === 'string' ? params.membershipType.trim() : ''
    if (membershipType) {
      safeParams.membershipType = membershipType
    }
    if (typeof params.lastVisitFrom === 'string' && params.lastVisitFrom) {
      safeParams.lastVisitFrom = params.lastVisitFrom
    }
    if (typeof params.lastVisitTo === 'string' && params.lastVisitTo) {
      safeParams.lastVisitTo = params.lastVisitTo
    }
    if (params.gender === 'MALE' || params.gender === 'FEMALE') {
      safeParams.gender = params.gender
    }
    const ageFrom = typeof params.ageFrom === 'string' ? Number(params.ageFrom) : Number.NaN
    if (Number.isFinite(ageFrom) && ageFrom > 0) {
      safeParams.ageFrom = Math.trunc(ageFrom)
    }
    const ageTo = typeof params.ageTo === 'string' ? Number(params.ageTo) : Number.NaN
    if (Number.isFinite(ageTo) && ageTo > 0) {
      safeParams.ageTo = Math.trunc(ageTo)
    }
    if (
      params.sortBy === 'fullName' ||
      params.sortBy === 'phone' ||
      params.sortBy === 'createdAt' ||
      params.sortBy === 'inGym' ||
      params.sortBy === 'status' ||
      params.sortBy === 'age' ||
      params.sortBy === 'lastVisitAt'
    ) {
      safeParams.sortBy = params.sortBy
    }
    if (params.sortOrder === 'asc' || params.sortOrder === 'desc') {
      safeParams.sortOrder = params.sortOrder
    }
    const { data } = await api.get('/clients', { params: safeParams })
    return { items: data.items as ClientRow[], total: data.total as number }
  },
  mapError: (e) =>
    resolveApiErrorMessage(e, {
      defaultMessage: t('clients.loadFailed'),
      byStatus: { 403: t('clients.forbidden') },
    }),
})

const tableItems = computed(() =>
  items.value.map((item) => {
    const remaining = getClientContractDaysLeft(
      item.effectiveContractStartDate ?? item.contractStartDate,
      item.effectiveContractEndDate ?? item.contractEndDate,
    )
    return {
      ...item,
      avatarUrl: clientPhotoDisplayUrl(item.photoUrl),
      membershipTypeId: item.membershipType,
      fullName: `${item.lastName} ${[item.firstName, item.middleName].filter(Boolean).map((v) => `${String(v).charAt(0)}.`).join('')}`.trim(),
      age: item.birthDate ? getAgeValue(item.birthDate.slice(0, 10)) : null,
      membershipType:
        memberships.value.find((membership) => membership.value === item.membershipType)?.text || '—',
      managerName:
        managers.value.find((m) => m.value === item.managerId)?.text || t('clients.noManager'),
      contractDaysText:
        remaining.daysLeft == null ? '—' : t('clients.daysLeftShort', { n: Math.max(0, remaining.daysLeft) }),
      contractDaysTone: remaining.tone,
    }
  }),
)

const hasClients = computed(() => tableItems.value.length > 0)
const membershipOptions = computed(() => [{ value: '', text: '—' }, ...memberships.value])
const currentManagerName = computed(() => {
  const user = auth.user
  if (!user) return t('clients.noManager')
  const fullName = [user.lastName, user.firstName].filter(Boolean).join(' ').trim()
  return fullName || user.login
})
const editorStatusOptions = computed(
  () => statusFilterOptions.value.slice(1) as Array<{ value: ClientStatus; text: string }>,
)
const createDirty = computed(
  () => JSON.stringify(createState.form.value) !== createInitialSnapshot.value,
)
const editDirty = computed(
  () => JSON.stringify(editState.form.value) !== editInitialSnapshot.value,
)

/** После авто-сохранения photoUrl в БД синхронизируем снимок, чтобы форма не считалась «грязной». */
function onEditPhotoUrlPersisted() {
  try {
    const s = JSON.parse(editInitialSnapshot.value) as ClientForm
    s.photoUrl = editState.form.value.photoUrl
    editInitialSnapshot.value = JSON.stringify(s)
  } catch {
    editInitialSnapshot.value = JSON.stringify(editState.form.value)
  }
}

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

const editPauseUntilCompactLabel = computed(() =>
  editPauseUntil.value ? `до ${formatRuDate(editPauseUntil.value)}` : '',
)

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
    address: form.address.trim() || undefined,
    notes: form.notes.trim() || undefined,
    membershipType: form.membershipType || undefined,
    cardNumber: form.cardNumber.trim() || undefined,
    photoUrl: form.photoUrl.trim() || undefined,
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
  createState.openForm()
  const now = new Date()
  const todayIso = formatDateIso(now)
  createState.form.value.contractStartDate = todayIso
  createState.form.value.paymentDate = todayIso
  createState.form.value.contractNumber = generateContractNumber(now)
  createInitialSnapshot.value = JSON.stringify(createState.form.value)
  createCardChecking.value = false
  createCardTaken.value = false
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

function openEdit(row: ClientRow) {
  editAttempted.value = false
  editingId.value = row.id
  editState.openForm({
    firstName: row.firstName || '',
    lastName: row.lastName || '',
    phone: row.phone || '',
    middleName: row.middleName || '',
    birthDate: row.birthDate ? row.birthDate.slice(0, 10) : '',
    gender: row.gender || '',
    status: row.status || 'ACTIVE',
    email: row.email || '',
    passport: row.passport || '',
    address: row.address || '',
    notes: row.notes || '',
    contractNumber: row.contractNumber || '',
    contractStartDate: toDateOnly(row.contractStartDate),
    contractEndDate: toDateOnly(row.contractEndDate),
    paymentDate: toDateOnly(row.paymentDate) || toDateOnly(row.contractStartDate) || toDateOnly(row.createdAt),
    membershipType: ((row as ClientRow & { membershipTypeId?: string | null }).membershipTypeId || row.membershipType || ''),
    cardNumber: row.cardNumber || '',
    photoUrl: row.photoUrl || '',
  })
  editHeaderSnapshot.value = {
    headline: getPersonHeadline(editState.form.value),
    status: row.status || 'ACTIVE',
    inGym: typeof row.inGym === 'boolean' ? row.inGym : null,
  }
  editInitialSnapshot.value = JSON.stringify(editState.form.value)
  editCardChecking.value = false
  editCardTaken.value = false
  const requestId = ++editHistoryRequestId.value
  void Promise.all([loadEditContractsHistory(row.id, requestId), loadEditPaymentsHistory(row.id, requestId)])
}

function closeClientRowActionsMenu(ev: Event) {
  const det = (ev.target as HTMLElement | null)?.closest('details')
  if (det) det.open = false
}

function runClientRowMenuAction(ev: Event, action: () => void) {
  closeClientRowActionsMenu(ev)
  action()
}

function onDocumentPointerDownCloseClientRowMenus(ev: Event) {
  const t = ev.target
  if (!(t instanceof Node)) return
  if (t instanceof Element && t.closest('.clients-row-menu')) return
  for (const el of document.querySelectorAll('details.clients-row-menu[open]')) {
    ;(el as HTMLDetailsElement).open = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDownCloseClientRowMenus, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDownCloseClientRowMenus, true)
})

let consumingEditClientFromUrl = false
watch(
  editClientId,
  async (id) => {
    const trimmed = typeof id === 'string' ? id.trim() : ''
    if (!trimmed || consumingEditClientFromUrl) return
    consumingEditClientFromUrl = true
    try {
      const { data } = await api.get<ClientRow>(`/clients/${trimmed}`)
      openEdit(data as ClientRow)
    } catch {
      notify({ color: 'danger', message: t('clients.loadFailed') })
    } finally {
      editClientId.value = ''
      consumingEditClientFromUrl = false
    }
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
}

function requestCloseEdit() {
  if (editState.loading.value) return
  if (editDirty.value) {
    discardTarget.value = 'edit'
    discardOpen.value = true
    return
  }
  editState.closeForm()
}

function discardChanges() {
  if (discardTarget.value === 'create') {
    createState.closeForm()
  } else if (discardTarget.value === 'edit') {
    editState.closeForm()
  }
  discardOpen.value = false
  discardTarget.value = null
}

async function openScannerTargetClient(id: string) {
  const existing = items.value.find((item) => item.id === id)
  if (existing) {
    openEdit(existing)
    ui.setScannerTargetClientId(null)
    return
  }

  try {
    const { data } = await api.get(`/clients/${id}`)
    openEdit(data as ClientRow)
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
  const code = (row.cardNumber?.trim() || row.accessKey?.trim()) ?? ''
  if (!code) {
    notify({ color: 'warning', message: t('clients.scannerNeedCardOrKey') })
    return
  }
  ui.requestScannerLookup(code)
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
  if (requiredInvalid(editState.form.value) || editCardTaken.value) {
    editState.error.value = null
    editFormRef.value?.focusFirstInvalid()
    return
  }
  editState.loading.value = true
  editState.error.value = null
  try {
    await api.patch(`/clients/${editingId.value}`, toPayload(editState.form.value, false))
    editState.closeForm()
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
      },
    })
  } finally {
    editState.loading.value = false
  }
}

async function loadEditContractsHistory(clientId: string, requestId = editHistoryRequestId.value) {
  editContractsLoading.value = true
  try {
    const { data } = await api.get(`/contracts/client/${clientId}`)
    if (editingId.value !== clientId || requestId !== editHistoryRequestId.value) return
    editContractsHistory.value = Array.isArray(data) ? data : []
    const paused = editContractsHistory.value.find((item) => item.status === 'PAUSED' && item.pauseUntil)
    editPauseUntil.value = paused?.pauseUntil ?? null
    const activeOrPaused = editContractsHistory.value.find(
      (item) => item.status === 'ACTIVE' || item.status === 'PAUSED',
    )
    if (editingId.value === clientId && requestId === editHistoryRequestId.value && activeOrPaused) {
      const docNumber = activeOrPaused.contractNumber?.trim()
      const startFromDoc = apiDateToFormIso(activeOrPaused.serviceStartDate ?? undefined)
      const endFromDoc = apiDateToFormIso(activeOrPaused.serviceEndDate ?? undefined)
      const next = { ...editState.form.value }
      let changed = false
      if (docNumber && !next.contractNumber.trim()) {
        next.contractNumber = docNumber
        changed = true
      }
      if (startFromDoc && !next.contractStartDate.trim()) {
        next.contractStartDate = startFromDoc
        changed = true
      }
      if (endFromDoc && !next.contractEndDate.trim()) {
        next.contractEndDate = endFromDoc
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

async function generateContractForEditingClient() {
  if (!editingId.value) return
  if (editDirty.value) {
    generateConfirmOpen.value = true
    return
  }
  await proceedGenerateContractForEditingClient()
}

async function generateContractFromTableRow(row: ClientRow) {
  contractGenerateLoadingId.value = row.id
  try {
    openEdit(row)
    await nextTick()
    await generateContractForEditingClient()
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
  if (requiredInvalid(editState.form.value) || editCardTaken.value) {
    editState.error.value = null
    editFormRef.value?.focusFirstInvalid()
    return
  }
  editState.loading.value = true
  editState.error.value = null
  try {
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
      },
    })
  } finally {
    editState.loading.value = false
  }
}

async function proceedGenerateContractForEditingClient() {
  if (!editingId.value) return
  if (!editState.form.value.contractNumber.trim()) {
    regenerateEditContractNumber()
  }
  const form = editState.form.value
  const maxAttempts = 8
  let canGenerate = false
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data } = await api.get<{ ok: boolean; reason?: string }>(
        `/contracts/client/${editingId.value}/can-generate`,
        { params: { contractNumber: form.contractNumber || undefined } },
      )
      if (data?.ok) {
        canGenerate = true
        break
      }
      if (data?.reason === 'ACTIVE_CONTRACT_EXISTS') {
        notify({ color: 'warning', message: t('clients.activeContractAlreadyExists') })
        return
      }
      if (data?.reason === 'CONTRACT_NUMBER_EXISTS') {
        regenerateEditContractNumber()
        continue
      }
      notify({ color: 'danger', message: t('clients.contractNumberRequired') })
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
      clientId: editingId.value,
      newContract: '1',
      contractNumber: form.contractNumber.trim() || undefined,
    },
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

async function refreshEditedClientStatus() {
  if (!editingId.value) return
  try {
    const { data } = await api.get<{ status?: ClientStatus }>(`/clients/${editingId.value}`)
    const nextStatus = data?.status
    if (
      !nextStatus ||
      (nextStatus !== 'ACTIVE' &&
        nextStatus !== 'PAUSED' &&
        nextStatus !== 'INACTIVE' &&
        nextStatus !== 'BLOCKED')
    ) {
      return
    }
    editState.form.value.status = nextStatus
    editHeaderSnapshot.value = {
      ...editHeaderSnapshot.value,
      status: nextStatus,
    }
  } catch {
    // keep current snapshot if fetch fails
  }
}

async function reloadEditedClientContractState() {
  if (!editingId.value) return
  const requestId = ++editHistoryRequestId.value
  await Promise.all([
    loadEditContractsHistory(editingId.value, requestId),
    loadEditPaymentsHistory(editingId.value, requestId),
    clientsSource.reload(),
    refreshEditedClientStatus(),
  ])
}

async function pauseContractFromHistory(contractId: string) {
  freezeTargetId.value = contractId
  freezeMode.value = 'preset'
  freezePreset.value = 7
  freezeForm.value = { startDate: '', endDate: '', reason: '' }
  freezeUiError.value = null
  freezeOpen.value = true
}

async function submitFreezeFromHistory() {
  if (!freezeTargetId.value) return
  freezeLoading.value = true
  freezeUiError.value = null
  try {
    if (freezeMode.value === 'preset') {
      if (freezePresetOptions.value.length === 0) {
        freezeUiError.value = t('contracts.freezeOutOfRange')
        return
      }
      if (!freezePresetOptions.value.some((option) => option.value === freezePreset.value)) {
        freezePreset.value = freezePresetOptions.value[0]!.value
      }
    }
    const payload =
      freezeMode.value === 'manual'
        ? {
            startDate: freezeForm.value.startDate || undefined,
            endDate: freezeForm.value.endDate || undefined,
            reason: freezeForm.value.reason.trim() || undefined,
          }
        : {
            durationDays: freezePreset.value,
            reason: freezeForm.value.reason.trim() || undefined,
          }
    await api.patch(`/contracts/${freezeTargetId.value}/pause`, payload)
    freezeOpen.value = false
    freezeTargetId.value = null
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
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

async function resumeContractFromHistory(contractId: string) {
  try {
    await api.patch(`/contracts/${contractId}/resume`)
    await reloadEditedClientContractState()
  } catch (e: unknown) {
    editState.error.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
        ONLY_PAUSED_CAN_RESUME: t('contracts.statusUpdateFailed'),
      },
    })
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
    await clientsSource.reload()
    if (editingId.value === row.id) {
      await refreshEditedClientStatus()
      await reloadEditedClientContractState()
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
    await clientsSource.reload()
    if (editingId.value === row.id) {
      await refreshEditedClientStatus()
      await reloadEditedClientContractState()
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
      editPauseUntil.value = null
      editState.resetForm()
      editState.error.value = null
      editInitialSnapshot.value = ''
      editCardChecking.value = false
      editCardTaken.value = false
    }
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
      } finally {
        editCardChecking.value = false
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
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateIso(value)
  return ''
}

function onLastVisitFromFilter(value: unknown) {
  patchFilters({ lastVisitFrom: toIsoDate(value) })
}

function onLastVisitToFilter(value: unknown) {
  patchFilters({ lastVisitTo: toIsoDate(value) })
}

function isoToDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

const visitRangeValue = computed(() => {
  const from = isoToDate(filters.value.lastVisitFrom)
  const to = isoToDate(filters.value.lastVisitTo)
  if (!from || !to) return undefined
  return [from, to] as [Date, Date]
})

function onVisitRangeFilter(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    patchFilters({ lastVisitFrom: '', lastVisitTo: '' })
    return
  }
  const from = toIsoDate(value[0])
  const to = toIsoDate(value[1])
  patchFilters({ lastVisitFrom: from, lastVisitTo: to })
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

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function diffDaysInclusive(startDate: Date, endDate: Date) {
  const start = startOfDay(startDate).getTime()
  const end = startOfDay(endDate).getTime()
  return Math.floor((end - start) / 86400000) + 1
}

const freezeTargetContract = computed(() =>
  editContractsHistory.value.find((item) => item.id === freezeTargetId.value) ?? null,
)

const freezeAvailableDays = computed(() => {
  const contract = freezeTargetContract.value
  if (!contract?.serviceEndDate) return 0
  const today = startOfDay(new Date())
  const contractStart = contract.serviceStartDate ? startOfDay(new Date(contract.serviceStartDate)) : today
  const contractEnd = startOfDay(new Date(contract.serviceEndDate))
  const freezeStart = contractStart > today ? contractStart : today
  if (Number.isNaN(contractEnd.getTime()) || contractEnd < freezeStart) return 0
  return diffDaysInclusive(freezeStart, contractEnd)
})

const freezePresetOptions = computed(() => {
  const available = freezeAvailableDays.value
  return [
    { value: 7 as const, text: t('contracts.freezePreset7') },
    { value: 14 as const, text: t('contracts.freezePreset14') },
    { value: 30 as const, text: t('contracts.freezePreset30') },
  ].filter((option) => option.value <= available)
})

watch(
  () => [freezeOpen.value, freezePresetOptions.value.length],
  () => {
    if (!freezeOpen.value || freezeMode.value !== 'preset') return
    if (freezePresetOptions.value.length === 0) return
    if (!freezePresetOptions.value.some((option) => option.value === freezePreset.value)) {
      freezePreset.value = freezePresetOptions.value[0]!.value
    }
  },
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
  try {
    const { data } = await api.get('/membership-catalog')
    memberships.value = (
      data as Array<{
        id: string
        name: string
        price?: number | null
        durationValue?: number | null
        durationUnit?: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
      }>
    ).map((item) => ({
      value: item.id,
      text: item.name,
      price: item.price == null ? null : Number(item.price),
      durationValue: item.durationValue ?? null,
      durationUnit: item.durationUnit ?? null,
    }))
  } catch {
    memberships.value = []
  }
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
    void clientsSource.reload()
  },
)

void (async () => {
  try {
    const { data } = await api.get('/users', {
      params: { page: 1, limit: 100, role: 'MANAGER', sortBy: 'login', sortOrder: 'asc' },
    })
    managers.value = (data.items as Array<{ id: string; firstName?: string; lastName?: string; login: string }>).map((u) => ({
      value: u.id,
      text: [u.lastName, u.firstName].filter(Boolean).join(' ').trim() || u.login,
    }))
  } catch {
    managers.value = []
  }
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
  <div>
    <AppPageCard :title="t('clients.title')">
      <template #actions>
        <VaButton preset="secondary" :disabled="loading" icon="refresh" @click="clientsSource.reload">
          {{ t('common.refresh') }}
        </VaButton>
        <VaButton color="primary" :disabled="loading" icon="add" @click="openCreate">
          {{ t('clients.add') }}
        </VaButton>
      </template>
      <template #filters>
        <div class="clients-filter-bar">
          <AppListFiltersToolbar :loading="loading">
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
              <VaDateInput
                :model-value="visitRangeValue"
                mode="range"
                :label="t('clients.lastVisitRange')"
                class="cf-visit toolbar-select toolbar-range"
                @update:model-value="onVisitRangeFilter"
              />
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
        <div class="clients-table-scroll">
          <VaDataTable
            class="clients-data-table app-table-actions-last-col"
            :items="tableItems"
            :columns="columns"
            :sort-by="sortBy ?? undefined"
            :sorting-order="sortOrder ?? undefined"
            disable-client-side-sorting
            @update:sort-by="handleSortByUpdate"
            @update:sorting-order="handleSortOrderUpdate"
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
              :title="t('clients.openScannerFromGymChip')"
              @click.stop="openScannerFromGymChip(rowData)"
            >
              <StatusBadge
                :label="rowData.inGym ? t('clients.inGymYes') : t('clients.inGymNo')"
                :tone="rowData.inGym ? 'success' : 'neutral'"
              />
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
              <details class="clients-row-menu" @click.stop>
                <summary class="clients-row-menu__trigger" :aria-label="t('clients.actionsMenu')">
                  <VaIcon name="more_vert" size="22px" />
                </summary>
                <ul class="clients-row-menu__list" role="menu" @click.stop>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="clients-row-menu__item"
                      @click="runClientRowMenuAction($event, () => openEdit(rowData))"
                    >
                      <VaIcon :name="TableActionIcon.edit" size="18px" />
                      {{ t('clients.edit') }}
                    </button>
                  </li>
                  <li v-if="rowData.status !== 'BLOCKED'" role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="clients-row-menu__item"
                      :disabled="
                        contractGenerateLoadingId === rowData.id || statusActionLoadingId === rowData.id
                      "
                      @click="
                        runClientRowMenuAction($event, () => void generateContractFromTableRow(rowData))
                      "
                    >
                      <VaIcon
                        :name="TableActionIcon.generateContract"
                        size="18px"
                        :class="{ 'clients-row-menu__icon--spin': contractGenerateLoadingId === rowData.id }"
                      />
                      {{ t('clients.generateContract') }}
                    </button>
                  </li>
                  <li v-if="canBlockOrDeleteClient && rowData.status !== 'BLOCKED'" role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="clients-row-menu__item clients-row-menu__item--warning"
                      :disabled="statusActionLoadingId === rowData.id"
                      @click="runClientRowMenuAction($event, () => blockClient(rowData))"
                    >
                      <VaIcon :name="TableActionIcon.blockClient" size="18px" />
                      {{ t('clients.block') }}
                    </button>
                  </li>
                  <li v-else-if="canBlockOrDeleteClient && rowData.status === 'BLOCKED'" role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="clients-row-menu__item"
                      :disabled="statusActionLoadingId === rowData.id"
                      @click="runClientRowMenuAction($event, () => unblockClient(rowData))"
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
                      @click="runClientRowMenuAction($event, () => askDelete(rowData))"
                    >
                      <VaIcon :name="TableActionIcon.delete" size="18px" />
                      {{ t('clients.delete') }}
                    </button>
                  </li>
                </ul>
              </details>
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

    <VaModal
      :model-value="createState.open.value"
      hide-default-actions
      fixed-layout
      max-width="min(95vw, 900px)"
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
            :current-manager-name="currentManagerName"
            :card-number-checking="createCardChecking"
            :card-number-taken="createCardTaken"
            @generate-contract-number="regenerateCreateContractNumber"
          />
        </AppSectionCard>
        <VaAlert v-if="createState.error.value" color="danger" outline>{{ createState.error.value }}</VaAlert>
        <div class="app-modal-actions">
          <VaButton type="button" preset="secondary" :disabled="createState.loading.value" @click="requestCloseCreate">{{ t('common.cancel') }}</VaButton>
          <VaButton type="submit" :loading="createState.loading.value">{{ t('users.save') }}</VaButton>
        </div>
      </form>
    </VaModal>

    <VaModal
      :model-value="editState.open.value"
      hide-default-actions
      fixed-layout
      max-width="min(95vw, 900px)"
      @update:model-value="(v) => (v ? (editState.open.value = true) : requestCloseEdit())"
    >
      <template #header />
      <form class="app-modal-form" @submit.prevent="updateClient" @keydown="handleEditHotkeys">
        <AppSectionCard class="client-editor-card" :title="t('clients.sectionPersonal')">
          <div class="person-header">
            <div class="person-headline-wrap">
              <div class="person-headline">{{ editHeaderSnapshot.headline }}</div>
            </div>
            <div class="person-status-wrap">
              <StatusBadge :label="statusLabel(editHeaderSnapshot.status)" :tone="statusColor(editHeaderSnapshot.status)" />
              <StatusBadge
                v-if="editHeaderSnapshot.status === 'ACTIVE'"
                :label="
                  editHeaderSnapshot.inGym == null
                    ? '—'
                    : editHeaderSnapshot.inGym
                    ? t('clients.inGymYes')
                    : t('clients.inGymNo')
                "
                :tone="editHeaderSnapshot.inGym ? 'success' : 'neutral'"
              />
              <span v-if="editPauseUntilCompactLabel" class="person-status-note">{{ editPauseUntilCompactLabel }}</span>
            </div>
          </div>
          <ClientFormFields
            ref="editFormRef"
            v-model="editState.form.value"
            :photo-upload-client-id="editingId"
            :is-create-mode="false"
            :attempted="editAttempted"
            :status-options="editorStatusOptions"
            :membership-options="membershipOptions"
            :current-manager-name="currentManagerName"
            :card-number-checking="editCardChecking"
            :card-number-taken="editCardTaken"
            :contract-history="editContractsHistory"
            :contract-history-loading="editContractsLoading"
            :payments-history="editPaymentsHistory"
            :payments-loading="editPaymentsLoading"
            @generate-contract-number="regenerateEditContractNumber"
            @open-contract-history-item="openContractFromHistory"
            @pause-contract-history-item="pauseContractFromHistory"
            @resume-contract-history-item="resumeContractFromHistory"
            @terminate-contract-history-item="terminateContractFromHistory"
            @photo-url-persisted="onEditPhotoUrlPersisted"
          />
        </AppSectionCard>
        <VaAlert v-if="editState.error.value" color="danger" outline>{{ editState.error.value }}</VaAlert>
        <div class="app-modal-actions">
          <VaButton
            type="button"
            preset="secondary"
            :icon="TableActionIcon.viewDocument"
            :disabled="editState.loading.value || !editingId || hasCurrentContractForEdit"
            :title="hasCurrentContractForEdit ? t('clients.activeContractAlreadyExists') : ''"
            @click="generateContractForEditingClient"
          >
            {{ t('clients.generateContract') }}
          </VaButton>
          <VaButton type="button" preset="secondary" :disabled="editState.loading.value" @click="requestCloseEdit">{{ t('common.cancel') }}</VaButton>
          <VaButton type="submit" :loading="editState.loading.value">{{ t('users.save') }}</VaButton>
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

    <VaModal v-model="freezeOpen" hide-default-actions fixed-layout max-width="520px">
      <h3 class="modal-title">{{ t('contracts.freezeTitle') }}</h3>
      <div class="modal-grid">
        <VaSelect
          v-model="freezeMode"
          :label="t('contracts.freezeMode')"
          :options="[
            { value: 'preset', text: t('contracts.freezePresetMode') },
            { value: 'manual', text: t('contracts.freezeManualMode') },
          ]"
          value-by="value"
          text-by="text"
          class="modal-grid__full"
        />
        <VaSelect
          v-if="freezeMode === 'preset'"
          v-model="freezePreset"
          :label="t('contracts.freezeDuration')"
          :options="freezePresetOptions"
          value-by="value"
          text-by="text"
          class="modal-grid__full"
        />
        <VaAlert
          v-if="freezeMode === 'preset' && freezePresetOptions.length === 0"
          color="warning"
          outline
          class="modal-grid__full"
        >
          {{ t('contracts.freezeOutOfRange') }}
        </VaAlert>
        <VaDateInput
          v-if="freezeMode === 'manual'"
          :model-value="freezeForm.startDate || undefined"
          :label="t('contracts.freezeStartDate')"
          @update:model-value="freezeForm.startDate = toIsoDate($event)"
        />
        <VaDateInput
          v-if="freezeMode === 'manual'"
          :model-value="freezeForm.endDate || undefined"
          :label="t('contracts.freezeEndDate')"
          @update:model-value="freezeForm.endDate = toIsoDate($event)"
        />
        <VaInput v-model="freezeForm.reason" :label="t('contracts.freezeReason')" class="modal-grid__full" />
        <VaAlert v-if="freezeUiError" color="danger" outline class="modal-grid__full">
          {{ freezeUiError }}
        </VaAlert>
      </div>
      <div class="app-modal-actions">
        <VaButton preset="secondary" @click="freezeOpen = false">{{ t('common.cancel') }}</VaButton>
        <VaButton
          :loading="freezeLoading"
          :disabled="freezeMode === 'preset' && freezePresetOptions.length === 0"
          @click="submitFreezeFromHistory"
        >
          {{ t('contracts.pause') }}
        </VaButton>
      </div>
    </VaModal>

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
.clients-filter-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.clients-filters-grid {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(5.5rem, auto);
  grid-template-areas:
    'search mship status ingym .'
    'gender age age visit reset';
  gap: 0.45rem 0.5rem;
  align-items: end;
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
  min-width: 0;
}
.cf-visit {
  grid-area: visit;
  min-width: 0;
}
.cf-reset {
  grid-area: reset;
  justify-self: end;
  align-self: end;
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
}
.toolbar-date {
  flex-basis: 11.5rem;
  min-width: 11.5rem;
  max-width: 13.5rem;
}
.toolbar-age-slider {
  min-width: 0;
  max-width: none;
  padding: 0.2rem 0.45rem 0.2rem 0.35rem;
  min-height: 3rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.age-slider__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}
.age-slider__label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--app-muted);
}
.age-slider__value {
  font-size: 0.76rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--app-text) 82%, var(--app-muted));
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
.person-status-wrap {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.45rem;
  max-width: 52%;
}
.person-status-note {
  font-size: 0.82rem;
  color: var(--app-muted);
  white-space: nowrap;
  line-height: 1;
}
.modal-title {
  margin: 0 0 0.75rem;
  font-size: 1.04rem;
  font-weight: 700;
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
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
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

.clients-row-menu {
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
}

.clients-row-menu__trigger {
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  color: var(--va-primary);
}

.clients-row-menu__trigger:hover {
  background: color-mix(in srgb, var(--app-surface) 86%, var(--va-primary) 14%);
}

.clients-row-menu__trigger::-webkit-details-marker {
  display: none;
}

.clients-row-menu__list {
  position: absolute;
  right: 0;
  top: calc(100% + 0.2rem);
  margin: 0;
  padding: 0.3rem;
  min-width: 12.5rem;
  list-style: none;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-soft);
  z-index: 50;
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

@media (max-width: 1200px) {
  .clients-filters-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'search search'
      'mship status'
      'ingym ingym'
      'gender gender'
      'age age'
      'visit visit'
      'reset reset';
  }
  .cf-reset {
    justify-self: stretch;
  }
  .clients-filters-reset {
    width: 100%;
  }
  .preset-strip--age,
  .preset-strip--visit {
    min-width: 100%;
    flex-basis: 100%;
    flex-wrap: wrap;
  }
}
@media (max-width: 760px) {
  .clients-filters-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      'search'
      'mship'
      'status'
      'ingym'
      'gender'
      'age'
      'visit'
      'reset';
  }
}
</style>
