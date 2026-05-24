<script setup lang="ts">
import axios from 'axios'
import IMask, { type InputMask } from 'imask'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useToast } from 'vuestic-ui'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppDateRangeFilter from '@/components/ui/AppDateRangeFilter.vue'
import ContractFreezeModal from '@/components/contracts/ContractFreezeModal.vue'
import ContractResumeModal from '@/components/contracts/ContractResumeModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { fetchActiveMembershipCatalogOptions } from '@/composables/membershipCatalogCache'
import { api } from '@/utils/api'
import {
  buildMonthNames,
  buildWeekdayNames,
  formatIsoDate,
  pickerValueToIsoYmd,
  hasDateFormatError,
  normalizeDateInputText,
  ruDateTextToIso,
  toDateValue,
  toRuDateText,
} from '@/utils/ruDateInput'
import { useFormTabNavigation } from '@/composables/useFormTabNavigation'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import {
  type ParsedContractCreateModalQuery,
  useContractCreateModalUrlSync,
} from '@/composables/useContractCreateModalUrlSync'
import { useManagerScope } from '@/composables/useManagerScope'
import { useUiStore } from '@/stores/ui'
import { detectQuickDatePreset, quickDatePresetRange, type QuickDatePreset } from '@/utils/dateRangePresets'

const { t, locale } = useI18n()
const { init: notify } = useToast()
const route = useRoute()
const router = useRouter()
const { isManagerReadOnly } = useManagerScope()
const ui = useUiStore()
const clientId = ref('')
const createContractModalOpen = ref(false)
/** Очередной абонемент: дата заключения сейчас, дату начала задаёт менеджер при запуске. */
const queueWithoutStart = ref(false)
const selectedMembershipId = ref('')

const form = reactive({
  contractNumber: '',
  lastName: '',
  firstName: '',
  middleName: '',
  email: '',
  birthDate: '',
  phone: '',
  address: '',
  clubAddress: '',
  passportNumber: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  serviceName: '',
  servicePrice: '',
  paymentAmount: '',
  paymentChannel: 'CASH' as 'CASH' | 'NON_CASH',
  contractDate: '',
  serviceStartDate: '',
  serviceEndDate: '',
  executorName: '',
  executorRepresentative: '',
})

type ClientOption = {
  value: string
  text: string
  firstName?: string | null
  lastName?: string | null
  middleName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  birthDate?: string | null
  passport?: string | null
  passportIssuedBy?: string | null
  passportIssuedAt?: string | null
}

type MembershipOption = {
  value: string
  text: string
  price: number | null
  durationValue: number | null
  durationUnit: 'DAY' | 'WEEK' | 'MONTH' | 'TRIAL' | null
}

const loadingGenerate = ref(false)
const loadingRegistry = ref(false)
const loadingClients = ref(false)
const loadingMoreClients = ref(false)
const loadingMemberships = ref(false)
const clientOptions = ref<ClientOption[]>([])
const CLIENT_OPTIONS_PAGE_SIZE = 25
const CLIENT_OPTIONS_SEARCH_DEBOUNCE_MS = 300
const clientOptionsPage = ref(1)
const clientOptionsTotal = ref(0)
const clientOptionsSearch = ref('')
let clientOptionsRequestId = 0
let clientOptionsSearchDebounce: ReturnType<typeof setTimeout> | null = null
const clientOptionsHasMore = computed(
  () => clientOptionsTotal.value > 0 && clientOptions.value.length < clientOptionsTotal.value,
)
type ContractRegistryRow = {
  id: string
  clientId: string
  contractNumber: string
  status: string
  contractDate?: string | Date | null
  serviceStartDate?: string | Date | null
  serviceEndDate?: string | Date | null
  servicePrice?: string | number | null
  s3Url?: string | null
  createdAt: string
  client: { firstName?: string; lastName?: string; middleName?: string } | null
}

/** Поля @db.Date в API приходят как ISO с полуночью UTC — сортируем по календарным Y-M-D. */
function registryDbDateSortTs(raw: string | Date | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const s = raw instanceof Date ? raw.toISOString() : String(raw)
  const ymd = s.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  return new Date(y, mo - 1, d).getTime()
}

const membershipOptions = ref<MembershipOption[]>([])
const contractsRegistry = ref<ContractRegistryRow[]>([])
const REGISTRY_DATE_FIELDS = ['contractDate', 'serviceStartDate', 'serviceEndDate'] as const
type RegistryDateField = (typeof REGISTRY_DATE_FIELDS)[number]

const REGISTRY_SORT_KEYS = [
  'contractNumber',
  'client',
  'status',
  'servicePrice',
  'contractDate',
  'serviceStartDate',
  'serviceEndDate',
] as const
type RegistrySortKey = (typeof REGISTRY_SORT_KEYS)[number]

const registryFilters = reactive({
  contractSearch: '',
  status: '',
  from: '',
  to: '',
  dateField: 'contractDate' as RegistryDateField,
})

const registrySortBy = ref<RegistrySortKey>('contractDate')
const registrySortOrder = ref<'asc' | 'desc'>('desc')

/** Не пушить query при применении фильтра из URL (защита от цикла). */
let applyingRegistryFromRoute = false
const registryPage = ref(1)
const registryLimit = ref(10)
const registryPageCount = computed(() =>
  Math.max(1, Math.ceil(sortedContractsRegistry.value.length / registryLimit.value)),
)

const activeRegistryDatePreset = computed(() => detectQuickDatePreset(registryFilters.from, registryFilters.to))

const registryDateFieldChoices = computed(() => [
  { value: 'contractDate', label: t('clients.contractHistoryContractDateColumn') },
  { value: 'serviceStartDate', label: t('clients.contractHistoryStartColumn') },
  { value: 'serviceEndDate', label: t('clients.contractHistoryEndColumn') },
])

const registryTableColumns = computed(() => [
  { key: 'contractNumber', label: t('contracts.contractNumber'), sortable: true },
  { key: 'client', label: t('clients.title'), sortable: true },
  { key: 'status', label: t('clients.statusLabel'), sortable: true },
  { key: 'servicePrice', label: t('contracts.servicePrice'), sortable: true },
  { key: 'contractDate', label: t('contracts.registryContractDateColumn'), sortable: true },
  { key: 'serviceStartDate', label: t('contracts.registryServiceStartColumn'), sortable: true },
  { key: 'serviceEndDate', label: t('contracts.registryServiceEndColumn'), sortable: true },
  { key: 'actions', label: t('clients.actions'), sortable: false },
])

function compareRegistryRows(a: ContractRegistryRow, b: ContractRegistryRow): number {
  const dir = registrySortOrder.value === 'asc' ? 1 : -1
  const key = registrySortBy.value

  if (key === 'contractNumber') {
    return dir * a.contractNumber.localeCompare(b.contractNumber, 'ru')
  }
  if (key === 'client') {
    return dir * registryClientFullName(a.client).localeCompare(registryClientFullName(b.client), 'ru')
  }
  if (key === 'status') {
    return dir * (a.status || '').localeCompare(b.status || '', 'ru')
  }
  if (key === 'servicePrice') {
    const na = Number(a.servicePrice)
    const nb = Number(b.servicePrice)
    const va = Number.isFinite(na) ? na : -1
    const vb = Number.isFinite(nb) ? nb : -1
    return dir * (va - vb)
  }
  if (key === 'contractDate' || key === 'serviceStartDate' || key === 'serviceEndDate') {
    const ta = registryDbDateSortTs(a[key])
    const tb = registryDbDateSortTs(b[key])
    const missing = registrySortOrder.value === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
    return dir * ((ta ?? missing) - (tb ?? missing))
  }
  return 0
}

const filteredContractsRegistry = computed(() => {
  const q = registryFilters.contractSearch.trim().toLowerCase()
  if (!q) return contractsRegistry.value
  return contractsRegistry.value.filter((row) =>
    row.contractNumber.toLowerCase().includes(q),
  )
})

const sortedContractsRegistry = computed(() => {
  const list = [...filteredContractsRegistry.value]
  list.sort(compareRegistryRows)
  return list
})

const pagedContractsRegistry = computed(() => {
  const start = (registryPage.value - 1) * registryLimit.value
  return sortedContractsRegistry.value.slice(start, start + registryLimit.value)
})
const hasRegistryItems = computed(() => sortedContractsRegistry.value.length > 0)

const lastPaymentAmountSyncedFromPrice = ref('')

const contractPaymentIsPartial = computed(() => {
  const total = Number(String(form.servicePrice).replace(',', '.'))
  const paid = Number(String(form.paymentAmount).replace(',', '.'))
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(paid)) return false
  return paid + 0.001 < total
})

function syncPaymentAmountFromServicePrice(force = false) {
  const price = form.servicePrice.trim()
  if (!price) {
    if (force) form.paymentAmount = ''
    return
  }
  const cur = form.paymentAmount.trim()
  if (force || !cur || cur === lastPaymentAmountSyncedFromPrice.value) {
    form.paymentAmount = price
    lastPaymentAmountSyncedFromPrice.value = price
  }
}

watch([registryPageCount, registryLimit], () => {
  if (registryPage.value > registryPageCount.value) registryPage.value = registryPageCount.value
})

const contractStatusOptions = ['ACTIVE', 'SAVED', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const

/** VaSelect не показывает подпись для value "", поэтому «Все» — отдельный маркер. */
const REGISTRY_STATUS_ALL = '__ALL__'

const registryStatusFilterOptions = computed(() => [
  { value: REGISTRY_STATUS_ALL, text: t('common.all') },
  ...contractStatusOptions.map((s) => ({ value: s, text: t(`contracts.contractStatuses.${s}`) })),
])

const hasActiveRegistryFilters = computed(
  () =>
    Boolean(registryFilters.contractSearch.trim()) ||
    Boolean(registryFilters.status) ||
    Boolean(registryFilters.from.trim()) ||
    Boolean(registryFilters.to.trim()) ||
    registryFilters.dateField !== 'contractDate',
)

const formError = ref<string | null>(null)
const formErrorCode = ref<string | null>(null)

function readApiErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const data = error.response?.data as { code?: unknown } | undefined
  return typeof data?.code === 'string' ? data.code : null
}

function clearFormError() {
  formError.value = null
  formErrorCode.value = null
}

const showQueueContractError = computed(
  () => formErrorCode.value === 'ACTIVE_CONTRACT_EXISTS' && Boolean(formError.value),
)
const showModalFormError = computed(
  () => Boolean(formError.value) && formErrorCode.value !== 'ACTIVE_CONTRACT_EXISTS',
)
const deleteOpen = ref(false)
const deleteLoading = ref(false)
const deleteTarget = ref<{ id: string; contractNumber: string } | null>(null)
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
const cancelForm = reactive({
  refundAmount: '',
  refundMethod: 'CASH',
  comment: '',
})
const contractsRowMenuOpenId = ref<string | null>(null)
const contractsRowMenuRow = ref<ContractRegistryRow | null>(null)
const contractsRowMenuAnchorRect = ref<DOMRect | null>(null)
const { onFormTabKeydown } = useFormTabNavigation({ loop: false })

const addressSuggestions = ref<string[]>([])
const addressSuggestLoading = ref(false)
const addressSuggestOpen = ref(false)
let addressSuggestTimer: ReturnType<typeof setTimeout> | null = null
let addressSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null

const clubAddressSuggestions = ref<string[]>([])
const clubAddressSuggestLoading = ref(false)
const clubAddressSuggestOpen = ref(false)
let clubAddressSuggestTimer: ReturnType<typeof setTimeout> | null = null
let clubAddressSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null
const contractPhoneFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const contractPassportNumberFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
let contractPhoneMask: InputMask<{ mask: string }> | null = null
let contractPassportNumberMask: InputMask<{ mask: string }> | null = null

function clearContractAddressSuggestUi() {
  addressSuggestions.value = []
  addressSuggestOpen.value = false
  addressSuggestLoading.value = false
  if (addressSuggestTimer) {
    clearTimeout(addressSuggestTimer)
    addressSuggestTimer = null
  }
  if (addressSuggestBlurTimer) {
    clearTimeout(addressSuggestBlurTimer)
    addressSuggestBlurTimer = null
  }
  clubAddressSuggestions.value = []
  clubAddressSuggestOpen.value = false
  clubAddressSuggestLoading.value = false
  if (clubAddressSuggestTimer) {
    clearTimeout(clubAddressSuggestTimer)
    clubAddressSuggestTimer = null
  }
  if (clubAddressSuggestBlurTimer) {
    clearTimeout(clubAddressSuggestBlurTimer)
    clubAddressSuggestBlurTimer = null
  }
  resetContractBirthDateField()
}

async function loadContractAddressSuggestions(query: string, kind: 'address' | 'club') {
  const normalized = query.trim()
  const loading = kind === 'address' ? addressSuggestLoading : clubAddressSuggestLoading
  const suggestions = kind === 'address' ? addressSuggestions : clubAddressSuggestions
  const openRef = kind === 'address' ? addressSuggestOpen : clubAddressSuggestOpen

  if (normalized.length < 3) {
    suggestions.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const { data } = await api.get<string[]>('/clients/address-suggestions', {
      params: { query: normalized },
    })
    suggestions.value = Array.isArray(data) ? data : []
    openRef.value = suggestions.value.length > 0
  } catch {
    suggestions.value = []
  } finally {
    loading.value = false
  }
}

function onContractAddressInput(value: string) {
  form.address = value
  if (addressSuggestTimer) clearTimeout(addressSuggestTimer)
  addressSuggestTimer = setTimeout(() => {
    void loadContractAddressSuggestions(value, 'address')
  }, 260)
}

function onContractClubAddressInput(value: string) {
  form.clubAddress = value
  if (clubAddressSuggestTimer) clearTimeout(clubAddressSuggestTimer)
  clubAddressSuggestTimer = setTimeout(() => {
    void loadContractAddressSuggestions(value, 'club')
  }, 260)
}

function onContractAddressFocus() {
  if (addressSuggestBlurTimer) {
    clearTimeout(addressSuggestBlurTimer)
    addressSuggestBlurTimer = null
  }
  addressSuggestOpen.value = addressSuggestions.value.length > 0
}

function onContractAddressBlur() {
  addressSuggestBlurTimer = setTimeout(() => {
    addressSuggestOpen.value = false
  }, 120)
}

function selectContractAddressSuggestion(value: string) {
  form.address = value
  addressSuggestOpen.value = false
}

function onContractClubAddressFocus() {
  if (clubAddressSuggestBlurTimer) {
    clearTimeout(clubAddressSuggestBlurTimer)
    clubAddressSuggestBlurTimer = null
  }
  clubAddressSuggestOpen.value = clubAddressSuggestions.value.length > 0
}

function onContractClubAddressBlur() {
  clubAddressSuggestBlurTimer = setTimeout(() => {
    clubAddressSuggestOpen.value = false
  }, 120)
}

function selectContractClubAddressSuggestion(value: string) {
  form.clubAddress = value
  clubAddressSuggestOpen.value = false
}

function unmountContractPhoneMask() {
  if (!contractPhoneMask) return
  contractPhoneMask.destroy()
  contractPhoneMask = null
}

function unmountContractPassportMask() {
  if (!contractPassportNumberMask) return
  contractPassportNumberMask.destroy()
  contractPassportNumberMask = null
}

function mountContractPhoneMask() {
  if (contractPhoneMask || !contractPhoneFieldRef.value) return
  const root =
    '$el' in contractPhoneFieldRef.value
      ? (contractPhoneFieldRef.value.$el as HTMLElement)
      : (contractPhoneFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  contractPhoneMask = IMask(input, {
    mask: '+{7} (000) 000-00-00',
    lazy: true,
  })
  contractPhoneMask.on('accept', () => {
    if (!contractPhoneMask) return
    const normalized = contractPhoneMask.unmaskedValue.length <= 1 ? '' : contractPhoneMask.value
    if (normalized !== form.phone) form.phone = normalized
  })
  contractPhoneMask.value = form.phone || ''
}

function mountContractPassportMask() {
  if (contractPassportNumberMask || !contractPassportNumberFieldRef.value) return
  const root =
    '$el' in contractPassportNumberFieldRef.value
      ? (contractPassportNumberFieldRef.value.$el as HTMLElement)
      : (contractPassportNumberFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  contractPassportNumberMask = IMask(input, {
    mask: '0000 000000',
    lazy: true,
  })
  contractPassportNumberMask.on('accept', () => {
    if (!contractPassportNumberMask) return
    const normalized =
      contractPassportNumberMask.unmaskedValue.length === 0 ? '' : contractPassportNumberMask.value
    if (normalized !== form.passportNumber) form.passportNumber = normalized
  })
  contractPassportNumberMask.value = form.passportNumber || ''
}

const contractBirthFieldWrapRef = ref<HTMLElement | null>(null)
const contractBirthTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const contractBirthTextValue = ref('')
const contractBirthPickerOpen = ref(false)
const contractBirthDateError = ref(false)
let contractBirthMask: InputMask<{ mask: string }> | null = null

const contractBirthPickerMonthNames = buildMonthNames('ru-RU')
const contractBirthPickerWeekdayNames = buildWeekdayNames('ru-RU')

function onContractBirthPickerPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (
    contractBirthPickerOpen.value &&
    contractBirthFieldWrapRef.value &&
    !contractBirthFieldWrapRef.value.contains(target)
  ) {
    contractBirthPickerOpen.value = false
  }
}

function unmountContractBirthMask() {
  if (!contractBirthMask) return
  contractBirthMask.destroy()
  contractBirthMask = null
}

function mountContractBirthMask() {
  if (contractBirthMask || !contractBirthTextFieldRef.value) return
  const root =
    '$el' in contractBirthTextFieldRef.value
      ? (contractBirthTextFieldRef.value.$el as HTMLElement)
      : (contractBirthTextFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  contractBirthMask = IMask(input, {
    mask: '00.00.0000',
    lazy: true,
    overwrite: true,
  })
  contractBirthMask.on('accept', () => {
    if (!contractBirthMask) return
    contractBirthTextValue.value = contractBirthMask.value
    contractBirthDateError.value = hasDateFormatError(contractBirthMask.value)
    const digits = contractBirthMask.unmaskedValue
    if (digits.length === 0) {
      if (form.birthDate) form.birthDate = ''
      return
    }
    if (digits.length < 8) return
    const iso = ruDateTextToIso(contractBirthMask.value)
    if (iso && iso !== form.birthDate) form.birthDate = iso
  })
  const initialBirthText = toRuDateText(form.birthDate)
  contractBirthTextValue.value = initialBirthText
  contractBirthMask.value = initialBirthText
}

function resetContractBirthDateField() {
  contractBirthPickerOpen.value = false
  unmountContractBirthMask()
}

function onContractBirthTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  contractBirthTextValue.value = normalized
  contractBirthDateError.value = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (contractBirthMask && contractBirthMask.value !== normalized) {
    contractBirthMask.value = normalized
  }
}

function onContractBirthTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(contractBirthTextValue.value)
  contractBirthTextValue.value = text
  if (contractBirthMask && contractBirthMask.value !== text) contractBirthMask.value = text
  contractBirthDateError.value = !valid
  form.birthDate = valid ? iso : ''
}

function onContractBirthDatePickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    form.birthDate = ''
    return
  }
  form.birthDate = formatIsoDate(value)
  contractBirthDateError.value = false
  contractBirthPickerOpen.value = false
  const text = toRuDateText(form.birthDate)
  contractBirthTextValue.value = text
  if (contractBirthMask) contractBirthMask.value = text
}

function clearContractBirthDate() {
  contractBirthTextValue.value = ''
  contractBirthDateError.value = false
  form.birthDate = ''
  if (contractBirthMask) contractBirthMask.value = ''
}

let lastHydratedModalClientId = ''

async function applyContractModalFromRoute(parsed: ParsedContractCreateModalQuery) {
  if (!parsed.shouldOpen) {
    createContractModalOpen.value = false
    lastHydratedModalClientId = ''
    return
  }

  queueWithoutStart.value = parsed.queueContract

  if (parsed.clientId) {
    if (parsed.clientId !== lastHydratedModalClientId) {
      await hydrateDraftFromClientApi(parsed.clientId, parsed.contractNumber || undefined)
      lastHydratedModalClientId = parsed.clientId
    }
    if (formError.value) {
      createContractModalOpen.value = false
      return
    }
    createContractModalOpen.value = true
    applyDefaultContractDates()
    return
  }

  lastHydratedModalClientId = ''
  createContractModalOpen.value = true
  applyDefaultContractDates()
}

useContractCreateModalUrlSync(route, router, {
  createContractModalOpen,
  clientId,
  queueWithoutStart,
  contractNumber: toRef(form, 'contractNumber'),
  managerReadOnly: isManagerReadOnly,
  isRouteSyncBlocked: () => applyingRegistryFromRoute,
  applyFromRoute: applyContractModalFromRoute,
})

async function hydrateDraftFromClientApi(cid: string, contractNumberFromQuery?: string) {
  formError.value = null
  /** До loadClientOptions: в список опций подмешивается GET /clients/:id, и sync в конце load не ломает форму. */
  clientId.value = cid
  try {
    resetClientOptionsSearchState()
    await Promise.all([loadClientOptions(''), loadMembershipOptions()])
    const { data } = await api.get(`/clients/${cid}`)
    const row = data as Record<string, unknown>
    const trimmed = contractNumberFromQuery?.trim()
    form.contractNumber = trimmed && trimmed.length > 0 ? trimmed : generateContractNumber(new Date())
    form.lastName = typeof row.lastName === 'string' ? row.lastName : ''
    form.firstName = typeof row.firstName === 'string' ? row.firstName : ''
    form.middleName = typeof row.middleName === 'string' ? row.middleName : ''
    if (row.birthDate instanceof Date) {
      form.birthDate = row.birthDate.toISOString().slice(0, 10)
    } else if (typeof row.birthDate === 'string') {
      form.birthDate = row.birthDate.slice(0, 10)
    } else {
      form.birthDate = ''
    }
    form.phone = typeof row.phone === 'string' ? row.phone : ''
    form.email = typeof row.email === 'string' ? row.email : ''
    form.address = typeof row.address === 'string' ? row.address : ''
    form.passportNumber = typeof row.passport === 'string' ? row.passport : ''
    form.passportIssuedBy = typeof row.passportIssuedBy === 'string' ? row.passportIssuedBy : ''
    if (row.passportIssuedAt instanceof Date) {
      form.passportIssuedAt = row.passportIssuedAt.toISOString().slice(0, 10)
    } else if (typeof row.passportIssuedAt === 'string') {
      form.passportIssuedAt = row.passportIssuedAt.slice(0, 10)
    } else {
      form.passportIssuedAt = ''
    }
    form.clubAddress = ''
    form.executorName = ''
    form.executorRepresentative = ''
    const mid = row.membershipType != null ? String(row.membershipType).trim() : ''
    selectedMembershipId.value =
      mid && membershipOptions.value.some((item) => item.value === mid) ? mid : ''
    syncMembershipFields(selectedMembershipId.value)
    if (row.paymentDate instanceof Date) {
      form.contractDate = row.paymentDate.toISOString().slice(0, 10)
    } else if (typeof row.paymentDate === 'string') {
      form.contractDate = row.paymentDate.slice(0, 10)
    } else {
      form.contractDate = ''
    }
    if (row.contractStartDate instanceof Date) {
      form.serviceStartDate = row.contractStartDate.toISOString().slice(0, 10)
    } else if (typeof row.contractStartDate === 'string') {
      form.serviceStartDate = row.contractStartDate.slice(0, 10)
    } else {
      form.serviceStartDate = ''
    }
    if (row.contractEndDate instanceof Date) {
      form.serviceEndDate = row.contractEndDate.toISOString().slice(0, 10)
    } else if (typeof row.contractEndDate === 'string') {
      form.serviceEndDate = row.contractEndDate.slice(0, 10)
    } else {
      form.serviceEndDate = ''
    }
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, { defaultMessage: t('contracts.saveFailed') })
  }
}

function syncClientFields(selectedClientId: string) {
  const trimmed = selectedClientId.trim()
  if (!trimmed) {
    form.firstName = ''
    form.lastName = ''
    form.middleName = ''
    form.phone = ''
    form.email = ''
    form.address = ''
    form.birthDate = ''
    return
  }
  const selected = clientOptions.value.find((item) => item.value === trimmed)
  /** Не затирать форму: клиент может быть ещё не в первой странице списка (после hydrateDraftFromClientApi). */
  if (!selected) return

  form.firstName = selected.firstName?.trim() || ''
  form.lastName = selected.lastName?.trim() || ''
  form.middleName = selected.middleName?.trim() || ''
  form.phone = selected.phone?.trim() || ''
  form.email = selected.email?.trim() || ''
  form.address = selected.address?.trim() || ''
  form.birthDate = selected.birthDate ? selected.birthDate.slice(0, 10) : ''
  form.passportNumber = selected.passport?.trim() || ''
  form.passportIssuedBy = selected.passportIssuedBy?.trim() || ''
  form.passportIssuedAt = selected.passportIssuedAt ? selected.passportIssuedAt.slice(0, 10) : ''
}

function syncMembershipFields(selectedId: string) {
  const trimmed = selectedId.trim()
  if (!trimmed) {
    form.serviceName = ''
    form.servicePrice = ''
    form.serviceEndDate = ''
    return
  }
  const selected = membershipOptions.value.find((item) => item.value === trimmed)
  if (!selected) {
    if (selectedMembershipId.value === trimmed) selectedMembershipId.value = ''
    form.serviceName = ''
    form.servicePrice = ''
    form.serviceEndDate = ''
    return
  }
  form.serviceName = selected.text
  form.servicePrice = selected.price == null ? '' : String(selected.price)
  syncPaymentAmountFromServicePrice(true)
  syncServiceEndDateByMembership()
}

function sanitizeSelectedMembershipId() {
  const id = selectedMembershipId.value.trim()
  if (!id) {
    selectedMembershipId.value = ''
    return
  }
  if (!membershipOptions.value.some((item) => item.value === id)) {
    selectedMembershipId.value = ''
  }
}

const hasActiveMembershipOptions = computed(() => membershipOptions.value.length > 0)

function parseRegistryStatusFromQuery(raw: string): string {
  if (!raw) return ''
  return contractStatusOptions.includes(raw as (typeof contractStatusOptions)[number]) ? raw : ''
}

function parseRegistryDateFieldFromQuery(raw: string): RegistryDateField {
  return (REGISTRY_DATE_FIELDS as readonly string[]).includes(raw) ? (raw as RegistryDateField) : 'contractDate'
}

function applyRegistryFiltersFromRoute() {
  const st = typeof route.query.fcStatus === 'string' ? route.query.fcStatus : ''
  registryFilters.status = parseRegistryStatusFromQuery(st)
  const fromRaw = typeof route.query.fcFrom === 'string' ? route.query.fcFrom.slice(0, 10) : ''
  const toRaw = typeof route.query.fcTo === 'string' ? route.query.fcTo.slice(0, 10) : ''
  registryFilters.from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : ''
  registryFilters.to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : ''
  const df = typeof route.query.fcDateField === 'string' ? route.query.fcDateField : ''
  registryFilters.dateField = parseRegistryDateFieldFromQuery(df)
}

function readRegistryFilterRouteSnapshot(q: typeof route.query): string {
  const st = typeof q.fcStatus === 'string' ? q.fcStatus : ''
  const from = typeof q.fcFrom === 'string' ? q.fcFrom.slice(0, 10) : ''
  const to = typeof q.fcTo === 'string' ? q.fcTo.slice(0, 10) : ''
  const df = typeof q.fcDateField === 'string' ? q.fcDateField : ''
  return `${st}|${from}|${to}|${df}`
}

function stripLegacyRegistryQueryParams() {
  if (typeof route.query.fcClient !== 'string') return false
  const base = normalizeRouteQuery(route.query)
  delete base.fcClient
  if (routeQueryEquals(base, route.query)) return false
  void router.replace({ query: base })
  return true
}

let registryFilterRouteSnapshot = ''

function pushRegistryFiltersToUrl() {
  const base = normalizeRouteQuery(route.query)
  const next: Record<string, string> = { ...base }
  for (const k of ['fcClient', 'fcStatus', 'fcFrom', 'fcTo', 'fcDateField'] as const) {
    delete next[k]
  }
  if (registryFilters.status.trim()) next.fcStatus = registryFilters.status.trim()
  if (registryFilters.from.trim()) next.fcFrom = registryFilters.from.trim().slice(0, 10)
  if (registryFilters.to.trim()) next.fcTo = registryFilters.to.trim().slice(0, 10)
  if (registryFilters.dateField !== 'contractDate') next.fcDateField = registryFilters.dateField
  if (routeQueryEquals(next, route.query)) return
  void router.replace({ query: next })
}

function resetContractsRegistryFilters() {
  applyingRegistryFromRoute = true
  registryFilters.contractSearch = ''
  registryFilters.status = ''
  registryFilters.from = ''
  registryFilters.to = ''
  registryFilters.dateField = 'contractDate'
  registrySortBy.value = 'contractDate'
  registrySortOrder.value = 'desc'
  const base = normalizeRouteQuery(route.query)
  for (const k of ['fcClient', 'fcStatus', 'fcFrom', 'fcTo', 'fcDateField'] as const) {
    delete base[k]
  }
  void router.replace({ query: base }).finally(() => {
    void nextTick(() => {
      applyingRegistryFromRoute = false
    })
  })
}

watch(
  () => route.query,
  () => {
    if (stripLegacyRegistryQueryParams()) return

    applyingRegistryFromRoute = true
    applyRegistryFiltersFromRoute()
    const snapshot = readRegistryFilterRouteSnapshot(route.query)
    const filtersChanged = snapshot !== registryFilterRouteSnapshot
    if (filtersChanged) {
      registryFilterRouteSnapshot = snapshot
      void loadContractsRegistry()
    }
    void nextTick(() => {
      applyingRegistryFromRoute = false
    })
  },
  { immediate: true },
)

watch(
  () => [registryFilters.status, registryFilters.from, registryFilters.to, registryFilters.dateField],
  () => {
    if (applyingRegistryFromRoute) return
    pushRegistryFiltersToUrl()
  },
)

watch([registrySortBy, registrySortOrder], () => {
  registryPage.value = 1
})

watch(
  () => registryFilters.contractSearch,
  () => {
    registryPage.value = 1
  },
)

watch(clientId, (value) => {
  syncClientFields(value)
})

watch(selectedMembershipId, (value) => {
  syncMembershipFields(value)
})

watch(
  () => form.serviceStartDate,
  () => {
    syncServiceEndDateByMembership()
  },
)

watch(
  () => form.servicePrice,
  () => {
    syncPaymentAmountFromServicePrice(false)
  },
)

watch(
  createContractModalOpen,
  async (open) => {
    if (!open) {
      contractBirthPickerOpen.value = false
      unmountContractBirthMask()
      unmountContractPhoneMask()
      unmountContractPassportMask()
      return
    }
    void loadMembershipOptions(true)
    await nextTick()
    contractBirthTextValue.value = toRuDateText(form.birthDate)
    await nextTick()
    mountContractBirthMask()
    mountContractPhoneMask()
    mountContractPassportMask()
    if (!contractBirthMask) {
      await nextTick()
      mountContractBirthMask()
    }
    if (!contractPhoneMask || !contractPassportNumberMask) {
      await nextTick()
      mountContractPhoneMask()
      mountContractPassportMask()
    }
  },
  { flush: 'post' },
)

watch(
  () => form.birthDate,
  (value) => {
    const next = toRuDateText(value || '')
    contractBirthTextValue.value = next
    if (!contractBirthMask) return
    if (contractBirthMask.value !== next) contractBirthMask.value = next
  },
)

watch(contractBirthTextValue, (value) => {
  contractBirthDateError.value = hasDateFormatError(value)
})

watch(
  () => form.phone,
  (value) => {
    if (!contractPhoneMask) return
    const next = value || ''
    if (contractPhoneMask.value !== next) contractPhoneMask.value = next
  },
)

watch(
  () => form.passportNumber,
  (value) => {
    if (!contractPassportNumberMask) return
    const next = value || ''
    if (contractPassportNumberMask.value !== next) contractPassportNumberMask.value = next
  },
)

function openCreateContractModal() {
  if (isManagerReadOnly.value) return
  resetClientOptionsSearchState()
  lastHydratedModalClientId = ''
  clientId.value = ''
  selectedMembershipId.value = ''
  syncMembershipFields('')
  void loadClientOptions('')
  void loadMembershipOptions(true)
  applyDefaultContractDates()
  createContractModalOpen.value = true
}

function closeCreateContractModal() {
  if (loadingGenerate.value) return
  clearContractAddressSuggestUi()
  resetClientOptionsSearchState()
  lastHydratedModalClientId = ''
  createContractModalOpen.value = false
}

function onCreateContractModalUpdate(open: boolean) {
  if (!open && loadingGenerate.value) return
  if (open && isManagerReadOnly.value && !route.query.newContract) return
  if (!open) {
    clearContractAddressSuggestUi()
    resetClientOptionsSearchState()
    lastHydratedModalClientId = ''
  }
  if (open) {
    applyDefaultContractDates()
    void loadClientOptions('')
  }
  createContractModalOpen.value = open
}

function mapClientRowToOption(item: Record<string, unknown>, fallbackId?: string): ClientOption {
  const idStr = String(item.id ?? fallbackId ?? '')
  const firstName = typeof item.firstName === 'string' ? item.firstName : ''
  const lastName = typeof item.lastName === 'string' ? item.lastName : ''
  const middleName = typeof item.middleName === 'string' ? item.middleName : ''
  const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ').trim()
  const phone = typeof item.phone === 'string' ? item.phone : ''
  return {
    value: idStr,
    text: fullName || phone || idStr,
    firstName,
    lastName,
    middleName,
    phone,
    email: typeof item.email === 'string' ? item.email : '',
    address: typeof item.address === 'string' ? item.address : '',
    birthDate: typeof item.birthDate === 'string' ? item.birthDate : null,
    passport: typeof item.passport === 'string' ? item.passport : '',
    passportIssuedBy: typeof item.passportIssuedBy === 'string' ? item.passportIssuedBy : '',
    passportIssuedAt: typeof item.passportIssuedAt === 'string' ? item.passportIssuedAt : null,
  }
}

async function loadMoreClientOptions() {
  if (!clientOptionsHasMore.value || loadingMoreClients.value || loadingClients.value) return
  loadingMoreClients.value = true
  const requestId = clientOptionsRequestId
  try {
    const nextPage = clientOptionsPage.value + 1
    const { data } = await api.get('/clients', {
      params: buildClientListParams(nextPage),
    })
    if (requestId !== clientOptionsRequestId) return
    const rows = Array.isArray(data?.items) ? data.items : []
    if (typeof data?.total === 'number') clientOptionsTotal.value = data.total
    const existing = new Set(clientOptions.value.map((o) => o.value))
    for (const raw of rows) {
      const item = raw as Record<string, unknown>
      const opt = mapClientRowToOption(item)
      if (!opt.value || existing.has(opt.value)) continue
      clientOptions.value.push(opt)
      existing.add(opt.value)
    }
    clientOptionsPage.value = nextPage
  } catch {
    // keep already loaded options
  } finally {
    loadingMoreClients.value = false
  }
}

function buildClientListParams(page: number, search = clientOptionsSearch.value) {
  const params: Record<string, string | number> = {
    page,
    limit: CLIENT_OPTIONS_PAGE_SIZE,
    sortBy: 'fullName',
    sortOrder: 'asc',
  }
  const q = search.trim()
  if (q) params.search = q
  return params
}

async function ensureExtraClientOptionsInList() {
  const extraIds = new Set<string>()
  if (clientId.value) extraIds.add(clientId.value)
  for (const cid of extraIds) {
    if (!cid || clientOptions.value.some((o) => o.value === cid)) continue
    try {
      const { data } = await api.get(`/clients/${cid}`)
      clientOptions.value.unshift(mapClientRowToOption(data as Record<string, unknown>, cid))
    } catch {
      // no-op
    }
  }
}

function clientOptionsSearchFn(_search: string, _option: unknown) {
  return true
}

function resetClientOptionsSearchState() {
  clientOptionsSearch.value = ''
  if (clientOptionsSearchDebounce) {
    clearTimeout(clientOptionsSearchDebounce)
    clientOptionsSearchDebounce = null
  }
}

function onClientOptionsSearchUpdate(value: string) {
  clientOptionsSearch.value = value
  if (clientOptionsSearchDebounce) clearTimeout(clientOptionsSearchDebounce)
  clientOptionsSearchDebounce = setTimeout(() => {
    void loadClientOptions(value)
  }, CLIENT_OPTIONS_SEARCH_DEBOUNCE_MS)
}

async function loadClientOptions(search = clientOptionsSearch.value) {
  const requestId = ++clientOptionsRequestId
  clientOptionsPage.value = 1
  clientOptionsSearch.value = search
  loadingClients.value = true
  try {
    const { data } = await api.get('/clients', {
      params: buildClientListParams(1, search),
    })
    if (requestId !== clientOptionsRequestId) return
    const rows = Array.isArray(data?.items) ? data.items : []
    clientOptionsTotal.value = typeof data?.total === 'number' ? data.total : rows.length
    clientOptions.value = rows.map((item: unknown) =>
      mapClientRowToOption(item as Record<string, unknown>),
    )
    await ensureExtraClientOptionsInList()
    if (clientId.value) {
      syncClientFields(clientId.value)
    }
  } catch {
    if (requestId !== clientOptionsRequestId) return
    clientOptions.value = []
    clientOptionsTotal.value = 0
    clientOptionsPage.value = 1
  } finally {
    if (requestId === clientOptionsRequestId) loadingClients.value = false
  }
}

async function loadMembershipOptions(force = false) {
  loadingMemberships.value = true
  try {
    membershipOptions.value = await fetchActiveMembershipCatalogOptions(force)
    sanitizeSelectedMembershipId()
    if (selectedMembershipId.value) {
      syncMembershipFields(selectedMembershipId.value)
    } else if (form.serviceName) {
      const matched = membershipOptions.value.find((item) => item.text === form.serviceName)
      if (matched) {
        selectedMembershipId.value = matched.value
      } else {
        form.serviceName = ''
        form.servicePrice = ''
        form.serviceEndDate = ''
      }
    }
  } catch {
    membershipOptions.value = []
    sanitizeSelectedMembershipId()
    form.serviceName = ''
    form.servicePrice = ''
    form.serviceEndDate = ''
  } finally {
    loadingMemberships.value = false
  }
}

function toIsoDate(value: unknown): string {
  return pickerValueToIsoYmd(value)
}

function generateContractNumber(baseDate = new Date()) {
  const y = baseDate.getFullYear()
  const m = String(baseDate.getMonth() + 1).padStart(2, '0')
  const d = String(baseDate.getDate()).padStart(2, '0')
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `CTR-${y}${m}${d}-${suffix}`
}

function regenerateContractNumber() {
  form.contractNumber = generateContractNumber(new Date())
}

function todayIsoDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Calendar date in local TZ — avoids UTC shift from `new Date('yyyy-mm-dd')` (wrong end date west of UTC). */
function parseDateIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

function formatDateIso(value: Date) {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

function syncServiceEndDateByMembership() {
  const selected = membershipOptions.value.find((item) => item.value === selectedMembershipId.value)
  if (!selected || !form.serviceStartDate) {
    form.serviceEndDate = ''
    return
  }
  form.serviceEndDate = calculateEndDate(
    form.serviceStartDate,
    selected.durationValue,
    selected.durationUnit,
  )
}

function applyDefaultContractDates() {
  const today = todayIsoDate()
  if (!form.contractDate) form.contractDate = today
  if (queueWithoutStart.value) {
    form.serviceStartDate = ''
    form.serviceEndDate = ''
  } else if (!form.serviceStartDate) {
    form.serviceStartDate = today
    syncServiceEndDateByMembership()
  }
  if (!form.contractNumber.trim()) form.contractNumber = generateContractNumber(new Date())
  if (form.servicePrice.trim()) syncPaymentAmountFromServicePrice(true)
}

watch(queueWithoutStart, (queued) => {
  if (queued) {
    form.serviceStartDate = ''
    form.serviceEndDate = ''
    if (formErrorCode.value === 'ACTIVE_CONTRACT_EXISTS') clearFormError()
  } else {
    applyDefaultContractDates()
  }
})

function payload() {
  const optional = (value: string) => {
    const next = value.trim()
    return next.length > 0 ? next : undefined
  }
  return {
    contractNumber: optional(form.contractNumber),
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    middleName: optional(form.middleName),
    birthDate: optional(form.birthDate),
    phone: optional(form.phone),
    email: optional(form.email),
    address: optional(form.address),
    clubAddress: optional(form.clubAddress),
    passportNumber: optional(form.passportNumber),
    passportIssuedBy: optional(form.passportIssuedBy),
    passportIssuedAt: optional(form.passportIssuedAt),
    serviceName: optional(form.serviceName),
    servicePrice: optional(form.servicePrice),
    contractDate: optional(form.contractDate),
    serviceStartDate: optional(form.serviceStartDate),
    serviceEndDate: optional(form.serviceEndDate),
    executorName: optional(form.executorName),
    executorRepresentative: optional(form.executorRepresentative),
    paymentAmount: optional(form.paymentAmount),
    paymentChannel: form.paymentChannel,
    flatten: true,
    extraFields: {},
  }
}

async function requestPdfBlob(): Promise<Blob> {
  const { data } = await api.post('/contracts/generate', payload(), {
    responseType: 'blob',
  })
  const blob = data instanceof Blob ? data : new Blob([data])
  if (!blob.type.includes('pdf')) {
    throw new Error('PDF response expected')
  }
  return blob
}

async function generateDownload() {
  loadingGenerate.value = true
  formError.value = null
  try {
    const blob = await requestPdfBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'contract.pdf'
    a.click()
    URL.revokeObjectURL(url)
    notify({ color: 'success', message: t('contracts.downloadReady') })
  } catch {
    formError.value = t('contracts.generateFailed')
  } finally {
    loadingGenerate.value = false
  }
}

async function generatePrint() {
  loadingGenerate.value = true
  formError.value = null
  try {
    const blob = await requestPdfBlob()
    const url = URL.createObjectURL(blob)
    const printWindow = window.open(url, '_blank')
    if (!printWindow) {
      formError.value = t('contracts.popupBlocked')
      return
    }
    printWindow.addEventListener('load', () => {
      printWindow.focus()
      printWindow.print()
    })
  } catch {
    formError.value = t('contracts.generateFailed')
  } finally {
    loadingGenerate.value = false
  }
}

async function saveContract() {
  if (!clientId.value.trim()) {
    formErrorCode.value = null
    formError.value = t('contracts.clientRequiredForSave')
    return
  }
  if (!selectedMembershipId.value.trim()) {
    formErrorCode.value = null
    formError.value = t('contracts.membershipRequiredForSave')
    return
  }
  if (!form.servicePrice.trim()) {
    formErrorCode.value = null
    formError.value = t('contracts.servicePriceRequired')
    return
  }
  const totalNum = Number(String(form.servicePrice).replace(',', '.'))
  const payRaw = form.paymentAmount.trim()
  if (!payRaw) {
    formErrorCode.value = null
    formError.value = t('contracts.paymentAmountRequired')
    return
  }
  const payNum = Number(payRaw.replace(',', '.'))
  if (!Number.isFinite(payNum) || payNum <= 0 || payNum > totalNum + 0.001) {
    formErrorCode.value = null
    formError.value = t('contracts.paymentAmountInvalid')
    return
  }
  loadingGenerate.value = true
  clearFormError()
  try {
    await api.post(`/contracts/client/${clientId.value.trim()}/save`, payload())
    notify({ color: 'success', message: t('contracts.saved') })
    ui.bumpPaymentsTableRefresh()
    clearContractAddressSuggestUi()
    createContractModalOpen.value = false
    await loadContractsRegistry()
  } catch (e: unknown) {
    formErrorCode.value = readApiErrorCode(e)
    formError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.saveFailed'),
      byCode: {
        ACTIVE_CONTRACT_EXISTS: t('clients.activeContractAlreadyExists'),
        ONLY_SAVED_CAN_ACTIVATE: t('contracts.onlySavedCanActivate'),
        ACTIVE_MEMBERSHIP_BLOCKS_ACTIVATE: t('contracts.activeMembershipBlocksActivate'),
        CONTRACT_NUMBER_EXISTS: t('clients.contractNumberTaken'),
        CONTRACT_NUMBER_REQUIRED: t('clients.contractNumberRequired'),
        SERVICE_PRICE_REQUIRED: t('contracts.servicePriceRequired'),
        SERVICE_DATE_RANGE_INVALID: t('contracts.saveFailed'),
        PAYMENT_AMOUNT_REQUIRED: t('contracts.paymentAmountRequired'),
        PAYMENT_AMOUNT_EXCEEDS_PRICE: t('contracts.paymentAmountInvalid'),
        INSTALLMENT_INITIAL_REQUIRED: t('contracts.paymentAmountRequired'),
        INSTALLMENT_INITIAL_INVALID: t('contracts.paymentAmountInvalid'),
      },
    })
  } finally {
    loadingGenerate.value = false
  }
}

async function loadContractsRegistry() {
  registryPage.value = 1
  loadingRegistry.value = true
  if (!createContractModalOpen.value) formError.value = null
  try {
    const from = registryFilters.from.trim()
    const to = registryFilters.to.trim()
    if (from && to && from > to) {
      if (!createContractModalOpen.value) {
        formError.value = t('payments.invalidDateRange')
      }
      contractsRegistry.value = []
      return
    }
    const params: Record<string, string> = {}
    if (registryFilters.status.trim()) params.status = registryFilters.status.trim()
    if (from) params.from = from.slice(0, 10)
    if (to) params.to = to.slice(0, 10)
    if (registryFilters.dateField !== 'contractDate') params.dateField = registryFilters.dateField
    const { data } = await api.get('/contracts', { params })
    contractsRegistry.value = (Array.isArray(data) ? data : []) as ContractRegistryRow[]
  } catch (e: unknown) {
    contractsRegistry.value = []
    if (!createContractModalOpen.value) {
      formError.value = resolveApiErrorMessage(e, {
        defaultMessage: t('contracts.registryLoadFailed'),
        byCode: {
          INVALID_DATE_FILTER: t('payments.invalidDateFilter'),
          INVALID_DATE_RANGE: t('payments.invalidDateRange'),
        },
      })
    }
  } finally {
    loadingRegistry.value = false
  }
}

async function openSavedContract(contractId: string) {
  try {
    const { data } = await api.get<{ url: string | null }>(`/contracts/${contractId}/open-url`)
    if (!data?.url) return
    window.open(data.url, '_blank')
  } catch {
    formError.value = t('clients.contractOpenFailed')
  }
}

function contractStatusLabel(value: string) {
  return t(`contracts.contractStatuses.${value}`)
}

function contractStatusTone(value: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (value === 'ACTIVE') return 'success'
  if (value === 'PAUSED') return 'warning'
  if (value === 'CANCELLED') return 'danger'
  if (value === 'EXPIRED') return 'neutral'
  return 'info'
}

function formatRegistryDbDateRu(raw: string | Date | null | undefined): string | null {
  if (raw == null || raw === '') return null
  const s = raw instanceof Date ? raw.toISOString() : String(raw)
  const ymd = s.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const tag = locale.value === 'en' ? 'en-US' : 'ru-RU'
  return new Date(y, mo - 1, d).toLocaleDateString(tag)
}

function formatRegistryDateCell(raw: string | Date | null | undefined): string {
  return formatRegistryDbDateRu(raw) ?? '—'
}

function registryClientFullName(client: ContractRegistryRow['client']): string {
  if (!client) return '—'
  return [client.lastName, client.firstName, client.middleName].filter(Boolean).join(' ').trim() || '—'
}

function goToClientPage(clientId: string) {
  void router.push({ name: 'clients', query: { edit: clientId } })
}

function closeContractRowActionsMenu() {
  contractsRowMenuOpenId.value = null
  contractsRowMenuRow.value = null
  contractsRowMenuAnchorRect.value = null
}

const contractsRowMenuLayerStyle = computed(() => {
  const r = contractsRowMenuAnchorRect.value
  if (!r || typeof window === 'undefined') return {}
  const gap = 6
  const reserve = 10
  const winW = window.innerWidth
  const winH = window.innerHeight
  const estMenuPx = 300
  const spaceBelow = winH - r.bottom - gap - reserve
  const spaceAbove = r.top - gap - reserve
  const openAbove =
    spaceBelow < Math.min(estMenuPx, 220) && spaceAbove > spaceBelow && spaceAbove > 80

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

function onContractRowMenuTriggerClick(row: ContractRegistryRow, ev: MouseEvent) {
  const el = ev.currentTarget
  if (!(el instanceof HTMLElement)) return
  if (contractsRowMenuOpenId.value === row.id) {
    closeContractRowActionsMenu()
    return
  }
  contractsRowMenuOpenId.value = row.id
  contractsRowMenuRow.value = row
  contractsRowMenuAnchorRect.value = el.getBoundingClientRect()
}

function runContractRowMenuAction(row: ContractRegistryRow | null, action: (r: ContractRegistryRow) => void) {
  if (!row) return
  closeContractRowActionsMenu()
  action(row)
}

function askFreezeContract(contractId: string) {
  freezeTargetId.value = contractId
  freezeUiError.value = null
  freezeOpen.value = true
}

const freezeTargetContract = computed(() =>
  contractsRegistry.value.find((row) => row.id === freezeTargetId.value) ?? null,
)

async function submitFreezeContract(payload: { startDate: string; endDate: string; reason: string }) {
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
    await loadContractsRegistry()
  } catch (e: unknown) {
    freezeUiError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.statusUpdateFailed'),
      byCode: {
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

function askResumeContract(contractId: string) {
  resumeTargetId.value = contractId
  resumeUiError.value = null
  resumeOpen.value = true
}

async function submitResumeContract() {
  if (!resumeTargetId.value) return
  resumeLoading.value = true
  resumeUiError.value = null
  try {
    await api.patch(`/contracts/${resumeTargetId.value}/resume`)
    resumeOpen.value = false
    resumeTargetId.value = null
    await loadContractsRegistry()
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

function askCancelContract(row: { id: string; contractNumber: string; servicePrice?: string | number | null }) {
  cancelTarget.value = { id: row.id, contractNumber: row.contractNumber }
  cancelForm.refundAmount =
    row.servicePrice == null || Number.isNaN(Number(row.servicePrice))
      ? '0'
      : Number(row.servicePrice).toFixed(2)
  cancelForm.refundMethod = 'CASH'
  cancelForm.comment = ''
  cancelOpen.value = true
}

async function submitCancelContract() {
  if (!cancelTarget.value) return
  cancelLoading.value = true
  try {
    await api.post(`/contracts/${cancelTarget.value.id}/cancel-with-refund`, {
      refundAmount: cancelForm.refundAmount,
      refundMethod: cancelForm.refundMethod,
      comment: cancelForm.comment.trim() || undefined,
    })
    cancelOpen.value = false
    cancelTarget.value = null
    await loadContractsRegistry()
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, {
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

function applyRegistryDatePreset(preset: QuickDatePreset) {
  const range = quickDatePresetRange(preset)
  registryFilters.from = range.from
  registryFilters.to = range.to
  registryPage.value = 1
}

function applyRegistryDateField(field: RegistryDateField) {
  if (registryFilters.dateField === field) return
  registryFilters.dateField = field
  registryPage.value = 1
}

function onRegistrySortByUpdate(next?: string) {
  if (!next || !(REGISTRY_SORT_KEYS as readonly string[]).includes(next)) return
  const key = next as RegistrySortKey
  if (registrySortBy.value === key) {
    registrySortOrder.value = registrySortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  registrySortBy.value = key
  registrySortOrder.value =
    key === 'contractDate' || key === 'serviceStartDate' || key === 'serviceEndDate' ? 'desc' : 'asc'
}

function onRegistrySortOrderUpdate(next?: string) {
  registrySortOrder.value = next === 'desc' ? 'desc' : 'asc'
}

function onRegistryStatusFilter(value: unknown) {
  const v = typeof value === 'string' ? value : ''
  registryFilters.status = v === REGISTRY_STATUS_ALL || v === '' ? '' : v
}

function askDeleteContract(row: { id: string; contractNumber: string }) {
  deleteTarget.value = row
  deleteOpen.value = true
}

async function deleteContract() {
  if (!deleteTarget.value) return
  deleteLoading.value = true
  try {
    await api.delete(`/contracts/${deleteTarget.value.id}`)
    deleteOpen.value = false
    deleteTarget.value = null
    notify({ color: 'success', message: t('contracts.deleted') })
    await loadContractsRegistry()
  } catch {
    formError.value = t('contracts.deleteFailed')
  } finally {
    deleteLoading.value = false
  }
}

function onDocumentPointerDownCloseContractRowMenus(ev: Event) {
  const t = ev.target
  if (!(t instanceof Element)) return
  if (t.closest('.contracts-row-menu-layer')) return
  if (t.closest('.contracts-row-menu__trigger')) return
  closeContractRowActionsMenu()
}

watch(registryPage, () => {
  closeContractRowActionsMenu()
})

onMounted(() => {
  document.addEventListener('pointerdown', onContractBirthPickerPointerDown, true)
  document.addEventListener('pointerdown', onDocumentPointerDownCloseContractRowMenus, true)
  window.addEventListener('resize', closeContractRowActionsMenu, { passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onContractBirthPickerPointerDown, true)
  document.removeEventListener('pointerdown', onDocumentPointerDownCloseContractRowMenus, true)
  window.removeEventListener('resize', closeContractRowActionsMenu)
  unmountContractPhoneMask()
  unmountContractPassportMask()
  if (clientOptionsSearchDebounce) clearTimeout(clientOptionsSearchDebounce)
  clearContractAddressSuggestUi()
})

void (async () => {
  await Promise.all([loadClientOptions(), loadMembershipOptions()])
})()

</script>

<template>
  <div class="contracts-page">
    <AppPageCard :title="t('contracts.title')">
      <template #actions>
        <VaButton preset="secondary" :disabled="loadingRegistry" icon="refresh" @click="loadContractsRegistry">
          {{ t('common.refresh') }}
        </VaButton>
        <VaButton
          v-if="!isManagerReadOnly"
          color="primary"
          icon="add"
          @click="openCreateContractModal"
        >
          {{ t('contracts.create') }}
        </VaButton>
      </template>

      <template #filters>
        <AppListFiltersToolbar>
          <div class="contracts-filter-bar">
            <div class="contracts-filters-grid">
              <VaInput
                v-model="registryFilters.contractSearch"
                :label="t('contracts.filterContract')"
                :placeholder="t('contracts.filterContractPlaceholder')"
                icon="search"
                clearable
              />
              <VaSelect
                :model-value="registryFilters.status === '' ? REGISTRY_STATUS_ALL : registryFilters.status"
                :label="t('contracts.filterStatus')"
                :options="registryStatusFilterOptions"
                text-by="text"
                value-by="value"
                @update:model-value="onRegistryStatusFilter"
              />
              <AppDateRangeFilter
                v-model:from="registryFilters.from"
                v-model:to="registryFilters.to"
                :label="t('contracts.filterDateRange')"
              />
            </div>
          </div>
          <template #actions>
            <VaButton
              size="small"
              preset="secondary"
              icon="close"
              :disabled="!hasActiveRegistryFilters"
              @click="resetContractsRegistryFilters"
            >
              {{ t('contracts.resetFilters') }}
            </VaButton>
          </template>
        </AppListFiltersToolbar>
      </template>

      <VaAlert v-if="formError && !createContractModalOpen" color="danger" outline class="contracts-error">
        {{ formError }}
      </VaAlert>

      <div class="contracts-presets-row">
        <div
          class="app-preset-strip preset-strip--date"
          :class="{ 'app-preset-strip--active': Boolean(activeRegistryDatePreset) }"
          role="group"
          :aria-label="t('contracts.datePresetsLabel')"
        >
          <VaIcon name="event" size="16px" color="secondary" />
          <span class="app-preset-label">{{ t('contracts.datePresetsLabel') }}</span>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeRegistryDatePreset === 'today' ? 'primary' : 'secondary'"
            @click="applyRegistryDatePreset('today')"
          >
            {{ t('clients.presetToday') }}
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeRegistryDatePreset === '7d' ? 'primary' : 'secondary'"
            @click="applyRegistryDatePreset('7d')"
          >
            {{ t('clients.preset7Days') }}
          </VaButton>
          <VaButton
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="activeRegistryDatePreset === '30d' ? 'primary' : 'secondary'"
            @click="applyRegistryDatePreset('30d')"
          >
            {{ t('clients.preset30Days') }}
          </VaButton>
        </div>
        <div
          class="app-preset-strip preset-strip--date-field"
          role="group"
          :aria-label="t('contracts.dateFilterFieldLabel')"
        >
          <VaIcon name="date_range" size="16px" color="secondary" />
          <span class="app-preset-label">{{ t('contracts.dateFilterFieldLabel') }}</span>
          <VaButton
            v-for="choice in registryDateFieldChoices"
            :key="choice.value"
            type="button"
            size="small"
            class="app-preset-chip"
            :preset="registryFilters.dateField === choice.value ? 'primary' : 'secondary'"
            @click="applyRegistryDateField(choice.value as RegistryDateField)"
          >
            {{ choice.label }}
          </VaButton>
        </div>
      </div>

      <AppDataTableShell
        :loading="loadingRegistry"
        :has-items="hasRegistryItems"
        :show-pager="hasRegistryItems && registryPageCount > 1"
      >
        <div class="contracts-table-scroll" @scroll.passive="closeContractRowActionsMenu">
        <VaDataTable
          class="contracts-registry-table app-table-actions-last-col"
          :items="pagedContractsRegistry"
          :loading="loadingRegistry"
          :sort-by="registrySortBy"
          :sorting-order="registrySortOrder"
          :columns="registryTableColumns"
          @update:sort-by="onRegistrySortByUpdate"
          @update:sorting-order="onRegistrySortOrderUpdate"
        >
          <template #cell(client)="{ rowData }">
            <span v-if="!rowData.clientId" class="contracts-registry-client-cell">{{ registryClientFullName(rowData.client) }}</span>
            <RouterLink
              v-else
              class="contracts-registry-client-link"
              :to="{ name: 'clients', query: { edit: rowData.clientId } }"
              :title="t('contracts.goToClientHint')"
            >
              <span>{{ registryClientFullName(rowData.client) }}</span>
              <VaIcon name="open_in_new" size="14px" class="contracts-registry-client-link__icon" aria-hidden="true" />
            </RouterLink>
          </template>
          <template #cell(servicePrice)="{ rowData }">
            {{ rowData.servicePrice == null ? '—' : Number(rowData.servicePrice).toFixed(2) }}
          </template>
          <template #cell(contractDate)="{ rowData }">
            {{ formatRegistryDateCell(rowData.contractDate) }}
          </template>
          <template #cell(serviceStartDate)="{ rowData }">
            {{ formatRegistryDateCell(rowData.serviceStartDate) }}
          </template>
          <template #cell(serviceEndDate)="{ rowData }">
            {{ formatRegistryDateCell(rowData.serviceEndDate) }}
          </template>
          <template #cell(status)="{ rowData }">
            <StatusBadge
              :label="contractStatusLabel(rowData.status || 'ACTIVE')"
              :tone="contractStatusTone(rowData.status || 'ACTIVE')"
            />
          </template>
          <template #cell(actions)="{ rowData }">
            <div class="contracts-registry-actions-cell">
              <div class="contracts-row-menu">
                <button
                  type="button"
                  class="contracts-row-menu__trigger"
                  :aria-label="t('contracts.actionsMenu')"
                  :aria-expanded="contractsRowMenuOpenId === rowData.id ? 'true' : 'false'"
                  @click.stop="onContractRowMenuTriggerClick(rowData, $event)"
                >
                  <VaIcon name="more_vert" size="22px" />
                </button>
              </div>
            </div>
          </template>
        </VaDataTable>
        </div>
        <template #pager>
          <AppTablePagerRow
            v-model:page="registryPage"
            v-model:limit="registryLimit"
            :pages="registryPageCount"
            :disabled="loadingRegistry"
          />
        </template>
        <template #empty>
          <AppEmptyState
            icon="description"
            :title="t('contracts.emptyTitle')"
            :description="t('contracts.emptyDesc')"
            :action-label="isManagerReadOnly ? undefined : t('contracts.create')"
            action-icon="add"
            @action="openCreateContractModal"
          />
        </template>
      </AppDataTableShell>
    </AppPageCard>

    <Teleport to="body">
      <div
        v-if="contractsRowMenuRow"
        class="contracts-row-menu-layer"
        :style="contractsRowMenuLayerStyle"
        @click.stop
      >
        <div class="contracts-row-menu__panel">
          <ul class="contracts-row-menu__list" role="menu">
            <li v-if="contractsRowMenuRow.clientId" role="none">
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => goToClientPage(r.clientId))"
              >
                <VaIcon name="person" size="18px" />
                {{ t('contracts.goToClient') }}
              </button>
            </li>
            <li v-if="!isManagerReadOnly && contractsRowMenuRow.status === 'ACTIVE'" role="none">
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => askFreezeContract(r.id))"
              >
                <VaIcon :name="TableActionIcon.contractPause" size="18px" />
                {{ t('contracts.pause') }}
              </button>
            </li>
            <li v-if="!isManagerReadOnly && contractsRowMenuRow.status === 'PAUSED'" role="none">
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => askResumeContract(r.id))"
              >
                <VaIcon :name="TableActionIcon.contractResume" size="18px" />
                {{ t('contracts.resume') }}
              </button>
            </li>
            <li
              v-if="
                !isManagerReadOnly &&
                contractsRowMenuRow.status !== 'CANCELLED' &&
                contractsRowMenuRow.status !== 'EXPIRED'
              "
              role="none"
            >
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item contracts-row-menu__item--warning"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => askCancelContract(r))"
              >
                <VaIcon :name="TableActionIcon.contractTerminate" size="18px" />
                {{ t('contracts.terminate') }}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item"
                :disabled="!contractsRowMenuRow.s3Url"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => openSavedContract(r.id))"
              >
                <VaIcon :name="TableActionIcon.openExternal" size="18px" />
                {{ t('contracts.openSaved') }}
              </button>
            </li>
            <li v-if="!isManagerReadOnly" role="none">
              <button
                type="button"
                role="menuitem"
                class="contracts-row-menu__item contracts-row-menu__item--danger"
                @click="runContractRowMenuAction(contractsRowMenuRow, (r) => askDeleteContract(r))"
              >
                <VaIcon :name="TableActionIcon.delete" size="18px" />
                {{ t('contracts.delete') }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>

    <VaModal
      class="contract-create-modal-shell"
      :model-value="createContractModalOpen"
      hide-default-actions
      no-padding
      max-width="min(95vw, 900px)"
      @update:model-value="onCreateContractModalUpdate"
    >
      <template #header />
      <VaInnerLoading
        :loading="loadingGenerate"
        size="large"
        class="contract-create-modal-loading"
        :aria-busy="loadingGenerate"
      >
        <div class="contract-create-modal" @keydown="onFormTabKeydown">
          <header class="contract-modal-header">
            <div class="contract-modal-header__lead">
              <div class="contract-modal-header__icon" aria-hidden="true">
                <VaIcon name="description" size="22px" />
              </div>
              <div class="contract-modal-header__copy">
                <h3 class="contract-modal-header__title">{{ t('contracts.formTitle') }}</h3>
                <p class="contract-modal-header__hint">{{ t('contracts.formHint') }}</p>
              </div>
            </div>
            <div class="contract-modal-header__toolbar">
              <VaButton
                type="button"
                preset="plain"
                color="primary"
                icon="download"
                size="medium"
                class="contract-modal-header__tool"
                :title="t('contracts.download')"
                :aria-label="t('contracts.download')"
                :disabled="loadingGenerate"
                @click="generateDownload"
              />
              <VaButton
                type="button"
                preset="plain"
                color="primary"
                icon="print"
                size="medium"
                class="contract-modal-header__tool"
                :title="t('contracts.print')"
                :aria-label="t('contracts.print')"
                :disabled="loadingGenerate"
                @click="generatePrint"
              />
              <button
                type="button"
                class="contract-modal-header__close"
                :disabled="loadingGenerate"
                :aria-label="t('common.cancel')"
                @click="closeCreateContractModal"
              >
                <VaIcon name="close" size="24px" />
              </button>
            </div>
          </header>

          <div class="contract-create-modal__scroll">
        <AppSectionCard>
          <div class="contracts-form-grid">
            <VaSelect
              :model-value="clientId"
              class="contracts-form-grid__full"
              :label="t('contracts.clientSelect')"
              :options="clientOptions"
              :loading="loadingClients || loadingMoreClients"
              text-by="text"
              value-by="value"
              searchable
              clearable
              :search="clientOptionsSearch"
              :search-fn="clientOptionsSearchFn"
              :min-search-chars="0"
              @update:search="onClientOptionsSearchUpdate"
              @scroll-bottom="loadMoreClientOptions"
              @update:model-value="(value) => (clientId = typeof value === 'string' ? value : '')"
            />
            <VaInput v-model="form.contractNumber" :label="t('contracts.contractNumber')" readonly>
              <template #appendInner>
                <VaButton
                  type="button"
                  preset="plain"
                  icon="autorenew"
                  size="small"
                  :disabled="loadingGenerate"
                  @click.stop="regenerateContractNumber"
                />
              </template>
            </VaInput>
            <VaInput v-model="form.lastName" :label="t('contracts.lastName')" />
            <VaInput v-model="form.firstName" :label="t('contracts.firstName')" />
            <VaInput v-model="form.middleName" :label="t('contracts.middleName')" />
            <VaInput v-model="form.email" :label="t('contracts.email')" />
            <div ref="contractBirthFieldWrapRef" class="custom-date-field">
              <VaInput
                ref="contractBirthTextFieldRef"
                :model-value="contractBirthTextValue"
                :label="t('contracts.birthDate')"
                :placeholder="t('contracts.birthDatePlaceholder')"
                inputmode="numeric"
                :class="{ 'date-input--invalid': contractBirthDateError }"
                :error="contractBirthDateError"
                :error-messages="contractBirthDateError ? [t('contracts.dateInvalidFormat')] : []"
                @focus="mountContractBirthMask()"
                @update:model-value="onContractBirthTextInput"
                @blur="onContractBirthTextBlur"
              >
                <template #appendInner>
                  <VaButton
                    v-if="contractBirthTextValue"
                    type="button"
                    preset="plain"
                    icon="close"
                    size="small"
                    class="date-clear-btn"
                    @click.stop="clearContractBirthDate"
                  />
                  <VaButton
                    type="button"
                    preset="plain"
                    icon="date_range"
                    size="medium"
                    class="date-trigger-btn"
                    @click.stop="contractBirthPickerOpen = !contractBirthPickerOpen"
                  />
                </template>
              </VaInput>
              <div v-if="contractBirthPickerOpen" class="date-picker-popup">
                <VaDatePicker
                  :model-value="toDateValue(form.birthDate)"
                  :month-names="contractBirthPickerMonthNames"
                  :weekday-names="contractBirthPickerWeekdayNames"
                  first-weekday="monday"
                  @update:model-value="onContractBirthDatePickerSelect"
                />
              </div>
            </div>
            <VaInput ref="contractPhoneFieldRef" v-model="form.phone" :label="t('contracts.phone')" />
            <div class="contracts-form-grid__full address-autocomplete">
              <VaInput
                :model-value="form.address"
                :label="t('contracts.address')"
                @update:model-value="onContractAddressInput"
                @focus="onContractAddressFocus"
                @blur="onContractAddressBlur"
              >
                <template #appendInner>
                  <VaIcon
                    v-if="addressSuggestLoading"
                    name="autorenew"
                    size="16px"
                    color="secondary"
                    class="address-autocomplete__spinner"
                  />
                </template>
              </VaInput>
              <div v-if="addressSuggestOpen && addressSuggestions.length" class="address-autocomplete__menu">
                <button
                  v-for="item in addressSuggestions"
                  :key="item"
                  type="button"
                  class="address-autocomplete__item"
                  @mousedown.prevent="selectContractAddressSuggestion(item)"
                >
                  {{ item }}
                </button>
              </div>
            </div>
            <div class="contracts-form-grid__full address-autocomplete">
              <VaInput
                :model-value="form.clubAddress"
                :label="t('contracts.clubAddress')"
                @update:model-value="onContractClubAddressInput"
                @focus="onContractClubAddressFocus"
                @blur="onContractClubAddressBlur"
              >
                <template #appendInner>
                  <VaIcon
                    v-if="clubAddressSuggestLoading"
                    name="autorenew"
                    size="16px"
                    color="secondary"
                    class="address-autocomplete__spinner"
                  />
                </template>
              </VaInput>
              <div v-if="clubAddressSuggestOpen && clubAddressSuggestions.length" class="address-autocomplete__menu">
                <button
                  v-for="item in clubAddressSuggestions"
                  :key="item"
                  type="button"
                  class="address-autocomplete__item"
                  @mousedown.prevent="selectContractClubAddressSuggestion(item)"
                >
                  {{ item }}
                </button>
              </div>
            </div>
            <VaInput
              ref="contractPassportNumberFieldRef"
              v-model="form.passportNumber"
              :label="t('contracts.passportNumber')"
            />
            <VaInput v-model="form.passportIssuedBy" :label="t('contracts.passportIssuedBy')" />
            <VaDateInput
              :model-value="form.passportIssuedAt || undefined"
              :label="t('contracts.passportIssuedAt')"
              @update:model-value="form.passportIssuedAt = toIsoDate($event)"
            />
            <div class="contracts-form-service-section">
              <p
                v-if="!loadingMemberships && !hasActiveMembershipOptions"
                class="contracts-form-service-section__notice"
              >
                {{ t('contracts.noActiveMemberships') }}
              </p>
              <VaSelect
                :model-value="selectedMembershipId"
                class="contracts-form-service-section__select"
                :label="t('contracts.serviceName')"
                :options="membershipOptions"
                :loading="loadingMemberships"
                :disabled="loadingMemberships || !hasActiveMembershipOptions"
                :placeholder="t('contracts.serviceSelectPlaceholder')"
                text-by="text"
                value-by="value"
                searchable
                clearable
                @update:model-value="(value) => (selectedMembershipId = typeof value === 'string' ? value : '')"
              />
            </div>

            <div class="contracts-form-bottom contracts-form-grid__full">
              <div class="contracts-form-block">
                <h4 class="contracts-form-block__title">{{ t('contracts.sectionServicePayment') }}</h4>
                <div class="contracts-form-block__grid contracts-form-block__grid--3">
                  <VaInput
                    v-model="form.servicePrice"
                    :label="`${t('contracts.servicePrice')} *`"
                    readonly
                    :error="!form.servicePrice.trim() && Boolean(formError)"
                  />
                  <VaInput
                    v-model="form.paymentAmount"
                    :label="`${t('contracts.paymentAmount')} *`"
                    inputmode="decimal"
                    :hint="contractPaymentIsPartial ? t('contracts.paymentAmountPartialHint') : undefined"
                  />
                  <div class="contracts-field-stack">
                    <span class="contracts-field-stack__label">{{ t('contracts.paymentChannel') }}</span>
                    <div class="contracts-segment" role="group" :aria-label="t('contracts.paymentChannel')">
                      <button
                        type="button"
                        class="contracts-segment__btn"
                        :class="{ 'contracts-segment__btn--active': form.paymentChannel === 'CASH' }"
                        @click="form.paymentChannel = 'CASH'"
                      >
                        {{ t('contracts.paymentCash') }}
                      </button>
                      <button
                        type="button"
                        class="contracts-segment__btn"
                        :class="{ 'contracts-segment__btn--active': form.paymentChannel === 'NON_CASH' }"
                        @click="form.paymentChannel = 'NON_CASH'"
                      >
                        {{ t('contracts.paymentNonCash') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="contracts-form-block">
                <h4 class="contracts-form-block__title">{{ t('contracts.sectionTerms') }}</h4>
                <div
                  class="contracts-form-block__grid"
                  :class="queueWithoutStart ? 'contracts-form-block__grid--1' : 'contracts-form-block__grid--3'"
                >
                  <VaDateInput
                    :model-value="form.contractDate || undefined"
                    :label="t('contracts.contractDate')"
                    @update:model-value="form.contractDate = toIsoDate($event)"
                  />
                  <VaDateInput
                    v-if="!queueWithoutStart"
                    :model-value="form.serviceStartDate || undefined"
                    :label="t('contracts.serviceStartDate')"
                    @update:model-value="form.serviceStartDate = toIsoDate($event)"
                  />
                  <VaDateInput
                    v-if="!queueWithoutStart"
                    :model-value="form.serviceEndDate || undefined"
                    :label="t('contracts.serviceEndDate')"
                    readonly
                  />
                </div>
                <label
                  class="contracts-queue-option"
                  :class="{ 'contracts-queue-option--attention': showQueueContractError }"
                >
                  <VaCheckbox v-model="queueWithoutStart" class="contracts-queue-option__checkbox" />
                  <span class="contracts-queue-option__body">
                    <span class="contracts-queue-option__label">{{ t('contracts.queueWithoutStart') }}</span>
                    <span class="contracts-queue-option__hint">{{ t('contracts.queueWithoutStartHint') }}</span>
                  </span>
                </label>
                <div v-if="showQueueContractError" class="contracts-context-notice" role="alert">
                  <VaIcon name="info" size="18px" class="contracts-context-notice__icon" aria-hidden="true" />
                  <p class="contracts-context-notice__text">{{ formError }}</p>
                </div>
              </div>

              <div class="contracts-form-block">
                <h4 class="contracts-form-block__title">{{ t('contracts.sectionExecutor') }}</h4>
                <div class="contracts-form-block__grid contracts-form-block__grid--2">
                  <VaInput v-model="form.executorName" :label="t('contracts.executorName')" />
                  <VaInput v-model="form.executorRepresentative" :label="t('contracts.executorRepresentative')" />
                </div>
              </div>
            </div>
          </div>
        </AppSectionCard>

        <div v-if="showModalFormError" class="contracts-form-error" role="alert">
          <VaIcon name="error_outline" size="18px" class="contracts-form-error__icon" aria-hidden="true" />
          <p class="contracts-form-error__text">{{ formError }}</p>
        </div>
          </div>

        <div class="app-modal-actions contract-create-modal__footer">
          <VaButton type="button" preset="secondary" :disabled="loadingGenerate" @click="closeCreateContractModal">
            {{ t('common.cancel') }}
          </VaButton>
          <VaButton
            type="button"
            color="primary"
            :disabled="loadingGenerate"
            icon="save"
            @click="saveContract"
          >
            {{ t('contracts.save') }}
          </VaButton>
        </div>
        </div>
      </VaInnerLoading>
    </VaModal>

    <ContractFreezeModal
      v-model="freezeOpen"
      :loading="freezeLoading"
      :error="freezeUiError"
      :contract-number="freezeTargetContract?.contractNumber"
      :service-start-date="freezeTargetContract?.serviceStartDate"
      :service-end-date="freezeTargetContract?.serviceEndDate"
      @submit="submitFreezeContract"
    />

    <ContractResumeModal
      v-model="resumeOpen"
      :contract-id="resumeTargetId"
      :loading="resumeLoading"
      :submit-error="resumeUiError"
      @submit="submitResumeContract"
    />

    <VaModal v-model="cancelOpen" hide-default-actions fixed-layout max-width="520px">
      <h3 class="modal-title">{{ t('contracts.cancelRefundTitle') }}</h3>
      <div class="contracts-form-grid">
        <VaInput
          v-model="cancelForm.refundAmount"
          :label="t('contracts.refundAmount')"
          class="contracts-form-grid__full"
        />
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
          class="contracts-form-grid__full"
        />
        <VaInput v-model="cancelForm.comment" :label="t('contracts.refundComment')" class="contracts-form-grid__full" />
      </div>
      <div class="contracts-actions contracts-actions--bottom app-modal-actions">
        <VaButton preset="secondary" @click="cancelOpen = false">{{ t('common.cancel') }}</VaButton>
        <VaButton color="warning" :loading="cancelLoading" @click="submitCancelContract">{{ t('contracts.terminate') }}</VaButton>
      </div>
    </VaModal>

    <ConfirmModal
      v-model="deleteOpen"
      :title="t('contracts.deleteTitle')"
      :message="t('contracts.deleteMessage', { number: deleteTarget?.contractNumber || '—' })"
      :confirm-label="t('contracts.delete')"
      :cancel-label="t('common.cancel')"
      :loading="deleteLoading"
      danger
      @confirm="deleteContract"
    />
  </div>
</template>

<style scoped>
.contracts-page {
  display: flex;
  flex-direction: column;
  gap: var(--app-page-gap);
}

.contracts-filter-bar {
  width: 100%;
}

.contracts-filter-bar :deep(.va-input-wrapper) {
  background: transparent !important;
}

.contracts-filter-bar :deep(.va-input-wrapper__field::after) {
  background: color-mix(in srgb, var(--app-surface) 97%, white 3%) !important;
  opacity: 1 !important;
}

.contracts-filter-bar :deep(.va-input-label) {
  background: transparent !important;
  box-shadow: none !important;
}

.contracts-filter-bar :deep(.va-select),
.contracts-filter-bar :deep(.va-date-input) {
  background: transparent;
}

.contracts-filters-grid {
  width: 100%;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(10rem, 1.25fr) minmax(9rem, 1fr) minmax(13rem, 1.35fr);
  align-items: end;
}

.contracts-presets-row {
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

.contracts-presets-row .preset-strip--date,
.contracts-presets-row .preset-strip--date-field {
  flex: 1 1 16rem;
  min-width: 16rem;
}

.contracts-presets-row .preset-strip--date-field {
  flex: 1 1 22rem;
  min-width: 22rem;
}

.contracts-registry-table.app-table-actions-last-col :deep(thead th:last-child),
.contracts-registry-table.app-table-actions-last-col :deep(tbody td:last-child) {
  text-align: right;
}

.contracts-registry-actions-cell {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.contracts-table-scroll {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.contracts-table-scroll :deep(.va-data-table:not(.va-data-table--virtual-scroller)) {
  overflow: visible;
}

.contracts-row-menu {
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
}

.contracts-row-menu__trigger {
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

.contracts-row-menu__trigger:hover {
  background: color-mix(in srgb, var(--app-surface) 86%, var(--va-primary) 14%);
}

.contracts-row-menu-layer {
  box-sizing: border-box;
  min-width: 12.5rem;
}

.contracts-row-menu-layer .contracts-row-menu__panel {
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-soft);
}

.contracts-row-menu__list {
  margin: 0;
  padding: 0.3rem;
  min-width: 12.5rem;
  list-style: none;
}

.contracts-registry-client-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--va-primary);
  text-decoration: none;
  font-weight: 600;
}

.contracts-registry-client-link:hover {
  text-decoration: underline;
}

.contracts-registry-client-link__icon {
  flex-shrink: 0;
  opacity: 0.78;
}

.contracts-row-menu__item {
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

.contracts-row-menu__item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--app-surface) 82%, var(--app-border) 18%);
}

.contracts-row-menu__item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.contracts-row-menu__item--warning {
  color: var(--va-warning);
}

.contracts-row-menu__item--danger {
  color: var(--va-danger);
}

@media (max-width: 960px) {
  .contracts-filters-grid {
    grid-template-columns: 1fr;
  }
}

/* Один общий оверлей при генерации/сохранении PDF вместо спиннеров на каждой кнопке */
.contract-create-modal-loading {
  position: relative;
  display: block;
  min-width: 0;
}

.contract-create-modal {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.contract-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  padding: 1.1rem 1.2rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  background: color-mix(in srgb, var(--app-surface) 98%, var(--app-bg-end));
}

.contract-modal-header__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  min-width: 0;
}

.contract-modal-header__icon {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent-strong, var(--app-accent));
}

.contract-modal-header__copy {
  min-width: 0;
}

.contract-modal-header__title {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--app-text);
}

.contract-modal-header__hint {
  margin: 0.3rem 0 0;
  font-size: 0.88rem;
  line-height: 1.4;
  color: color-mix(in srgb, var(--app-text) 62%, transparent);
}

.contract-modal-header__toolbar {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.contract-modal-header__tool {
  min-width: 2.85rem !important;
  min-height: 2.85rem !important;
}

.contract-modal-header__tool :deep(.va-icon),
.contract-modal-header__tool :deep(.material-icons) {
  font-size: 1.45rem !important;
}

.contract-modal-header__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.85rem;
  height: 2.85rem;
  margin-left: 0.15rem;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 58%, transparent);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.contract-modal-header__close:hover:not(:disabled) {
  background: color-mix(in srgb, var(--app-text) 7%, transparent);
  color: var(--app-text);
}

.contract-modal-header__close:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.contract-create-modal__scroll {
  --contract-create-scroll-max-height: calc(100vh - 14rem);
  --contract-create-scroll-max-height: calc(100dvh - 14rem);
  flex: 0 0 auto;
  width: 100%;
  height: fit-content;
  max-height: var(--contract-create-scroll-max-height);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1rem 1.2rem 0.65rem;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--app-muted) 28%, transparent) transparent;
}

.contract-create-modal__scroll::-webkit-scrollbar {
  width: 9px;
}

.contract-create-modal__scroll::-webkit-scrollbar-track {
  background: transparent;
}

.contract-create-modal__scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--app-muted) 28%, transparent);
}

.contract-create-modal__scroll :deep(.section-card) {
  border: 0;
  padding: 0;
  background: transparent;
}

.contract-create-modal__scroll :deep(.section-card__content) {
  padding: 0;
}

.contract-create-modal__footer {
  flex-shrink: 0;
  padding: 0.35rem 1.2rem 1.15rem;
}

.contract-create-modal__footer.app-modal-actions {
  gap: 0.5rem;
}

.contracts-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.contracts-form-grid :deep(.va-input-wrapper__container),
.contracts-form-grid :deep(.va-input-wrapper__field),
.contracts-form-grid :deep(.va-select__anchor) {
  min-height: var(--app-control-height);
}

.contracts-form-grid :deep(.va-input-wrapper__messages) {
  min-height: 1.2rem;
  margin-top: 0.2rem;
}

.contracts-form-grid :deep(.va-message-list__list) {
  min-height: 1.2rem;
}

.contracts-form-grid__full {
  grid-column: 1 / -1;
}

.contracts-form-section-start {
  margin-top: 0.15rem;
  padding-top: 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.contracts-form-service-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.contracts-form-service-section__notice {
  margin: 0;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--va-warning) 24%, var(--app-border));
  background: color-mix(in srgb, var(--va-warning) 7%, var(--app-surface));
  color: color-mix(in srgb, var(--app-text) 78%, var(--va-warning));
  font-size: 0.75rem;
  line-height: 1.4;
}

.contracts-form-service-section__select {
  width: 100%;
}

.contracts-form-service-section :deep(.va-select--disabled .va-select__anchor) {
  opacity: 1;
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
}

.contracts-form-bottom {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  margin-top: 0.15rem;
  padding-top: 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.contracts-form-block {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.contracts-form-block__title {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--app-text) 58%, transparent);
}

.contracts-form-block__grid {
  display: grid;
  gap: 0.75rem;
}

.contracts-form-block__grid--1 {
  grid-template-columns: minmax(0, 1fr);
  max-width: min(100%, 20rem);
}

.contracts-form-block__grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.contracts-form-block__grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.contracts-field-stack {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.contracts-field-stack__label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--va-secondary, #6b7280);
}

.contracts-segment {
  display: flex;
  min-height: var(--app-control-height);
  padding: 0.2rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
}

.contracts-segment__btn {
  flex: 1 1 0;
  min-height: calc(var(--app-control-height) - 0.45rem);
  padding: 0.35rem 0.65rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 72%, transparent);
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.contracts-segment__btn:hover:not(.contracts-segment__btn--active) {
  background: color-mix(in srgb, var(--app-text) 5%, transparent);
}

.contracts-segment__btn--active {
  background: var(--app-surface);
  color: var(--app-text);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-text) 12%, transparent);
}

.contracts-queue-option {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  margin: 0.1rem 0 0;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-text) 3.5%, var(--app-surface));
  cursor: pointer;
}

.contracts-queue-option__checkbox {
  flex-shrink: 0;
  margin-top: 0.05rem;
}

.contracts-queue-option__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.contracts-queue-option__label {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.35;
}

.contracts-queue-option__hint {
  font-size: 0.84rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--app-text) 62%, transparent);
}

.contracts-queue-option--attention {
  border: 1px solid color-mix(in srgb, var(--va-warning) 42%, var(--app-border));
  background: color-mix(in srgb, var(--va-warning) 7%, var(--app-surface));
}

.contracts-context-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: -0.15rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--va-warning) 38%, var(--app-border));
  background: color-mix(in srgb, var(--va-warning) 6%, var(--app-surface));
}

.contracts-context-notice__icon {
  flex-shrink: 0;
  margin-top: 0.05rem;
  color: color-mix(in srgb, var(--va-warning) 82%, var(--app-text));
}

.contracts-context-notice__text {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--app-text) 78%, transparent);
}

.contracts-form-error {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--va-danger) 32%, var(--app-border));
  background: color-mix(in srgb, var(--va-danger) 6%, var(--app-surface));
}

.contracts-form-error__icon {
  flex-shrink: 0;
  margin-top: 0.05rem;
  color: color-mix(in srgb, var(--va-danger) 78%, var(--app-text));
}

.contracts-form-error__text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--app-text);
}

.contracts-form-grid :deep(.va-date-input input),
.contracts-form-grid :deep(.va-input-wrapper input:not([type='hidden'])) {
  color: var(--app-text, inherit);
}

.address-autocomplete {
  position: relative;
  width: 100%;
}

.address-autocomplete :deep(.va-input-wrapper) {
  width: 100%;
}

.address-autocomplete__spinner {
  animation: address-spin 0.9s linear infinite;
}

.address-autocomplete__menu {
  position: absolute;
  z-index: 45;
  left: 0;
  right: 0;
  top: calc(100% - 0.35rem);
  border: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-soft);
  padding: 0.22rem;
  display: grid;
  gap: 0.12rem;
}

.address-autocomplete__item {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.42rem 0.5rem;
  border-radius: 8px;
  color: var(--app-text);
  cursor: pointer;
}

.address-autocomplete__item:hover {
  background: color-mix(in srgb, var(--app-surface) 78%, var(--app-border) 22%);
}

@keyframes address-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.custom-date-field {
  position: relative;
}

.custom-date-field :deep(.va-input-wrapper) {
  width: 100%;
}

.custom-date-field :deep(.date-input--invalid .va-input-wrapper__field) {
  border-color: var(--va-danger) !important;
  box-shadow: inset 0 0 0 1px var(--va-danger) !important;
}

.custom-date-field :deep(.date-input--invalid .va-input-wrapper--focused .va-input-wrapper__field) {
  border-color: var(--va-danger) !important;
  box-shadow: inset 0 0 0 1px var(--va-danger) !important;
}

.date-picker-popup {
  position: absolute;
  z-index: 40;
  top: calc(100% + 0.25rem);
  left: 50%;
  transform: translateX(-50%);
  min-width: 18rem;
  max-width: min(20rem, calc(100vw - 2rem));
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  box-shadow: var(--app-shadow-soft);
  background: var(--app-surface);
  border-radius: 10px;
  overflow: hidden;
}

.date-picker-popup :deep(.va-date-picker__month-year) {
  font-size: 0.92rem;
}

.date-trigger-btn :deep(.va-button__content) {
  min-width: 1.75rem;
}

.date-clear-btn {
  display: none;
}

.custom-date-field:hover .date-clear-btn {
  display: inline-flex;
}

.date-trigger-btn :deep(.va-icon) {
  font-size: 1.15rem;
}

.contracts-actions {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.contracts-actions--bottom {
  justify-content: flex-end;
}

.contracts-actions :deep(.va-button) {
  min-height: var(--app-action-height);
  min-width: 10.5rem;
}

.contracts-error {
  margin-top: 0.75rem;
  width: 100%;
}

.modal-title {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
  font-weight: 700;
}

.fields-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-row {
  display: flex;
  justify-content: space-between;
  gap: 0.7rem;
  border-bottom: 1px solid var(--app-border);
  padding: 0.35rem 0;
}

.field-name {
  color: var(--app-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.84rem;
}

.field-type {
  color: var(--app-muted);
  font-size: 0.82rem;
}

@media (max-width: 840px) {
  .contract-modal-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .contract-modal-header__toolbar {
    justify-content: flex-end;
  }

  .contracts-form-grid {
    grid-template-columns: 1fr;
  }

  .contracts-form-block__grid--2,
  .contracts-form-block__grid--3 {
    grid-template-columns: 1fr;
  }

  .contracts-form-block__grid--1 {
    max-width: none;
  }

  .contracts-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .contracts-actions :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }

  .contract-create-modal__scroll {
    --contract-create-scroll-max-height: calc(100dvh - 12.5rem);
    padding: 0.85rem 0.9rem 0.55rem;
  }

  .contract-create-modal__footer {
    padding: 0.3rem 0.9rem 0.85rem;
  }
}
</style>
