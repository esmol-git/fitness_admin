<script setup lang="ts">
import IMask, { type InputMask } from 'imask'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'vuestic-ui'
import AppDataTableShell from '@/components/ui/AppDataTableShell.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPageCard from '@/components/ui/AppPageCard.vue'
import AppListFiltersToolbar from '@/components/ui/AppListFiltersToolbar.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import AppSectionCard from '@/components/ui/AppSectionCard.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { TableActionIcon } from '@/config/tableActionIcons'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { api } from '@/utils/api'
import {
  buildMonthNames,
  buildWeekdayNames,
  formatIsoDate,
  hasDateFormatError,
  normalizeDateInputText,
  ruDateTextToIso,
  toDateValue,
  toRuDateText,
} from '@/utils/ruDateInput'
import { useFormTabNavigation } from '@/composables/useFormTabNavigation'
import { normalizeRouteQuery, routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { useManagerScope } from '@/composables/useManagerScope'

const { t } = useI18n()
const { init: notify } = useToast()
const route = useRoute()
const router = useRouter()
const { isManagerReadOnly } = useManagerScope()
const clientId = ref('')
const createContractModalOpen = ref(false)
const selectedMembershipId = ref('')

const form = reactive({
  contractNumber: '',
  city: '',
  firstName: '',
  lastName: '',
  middleName: '',
  birthDate: '',
  phone: '',
  email: '',
  address: '',
  clubAddress: '',
  passportNumber: '',
  passportIssuedBy: '',
  passportIssuedAt: '',
  serviceName: '',
  servicePrice: '',
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
const clientOptionsPage = ref(1)
const clientOptionsTotal = ref(0)
const clientOptionsHasMore = computed(
  () => clientOptionsTotal.value > 0 && clientOptions.value.length < clientOptionsTotal.value,
)
const membershipOptions = ref<MembershipOption[]>([])
const contractsRegistry = ref<
  Array<{
    id: string
    clientId: string
    contractNumber: string
    status: string
    servicePrice?: string | number | null
    s3Url?: string | null
    createdAt: string
    client: { firstName?: string; lastName?: string; middleName?: string } | null
  }>
>([])
const registryFilters = reactive({
  clientId: '',
  status: '',
  from: '',
  to: '',
})

/** Не пушить query при применении фильтра из URL (защита от цикла). */
let applyingRegistryFromRoute = false
const registryPage = ref(1)
const registryLimit = ref(10)
const registryPageCount = computed(() =>
  Math.max(1, Math.ceil(contractsRegistry.value.length / registryLimit.value)),
)
const pagedContractsRegistry = computed(() => {
  const start = (registryPage.value - 1) * registryLimit.value
  return contractsRegistry.value.slice(start, start + registryLimit.value)
})
const hasRegistryItems = computed(() => contractsRegistry.value.length > 0)

watch([registryPageCount, registryLimit], () => {
  if (registryPage.value > registryPageCount.value) registryPage.value = registryPageCount.value
})

const contractStatusOptions = ['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const

/** VaSelect не показывает подпись для value "", поэтому «Все» — отдельный маркер. */
const REGISTRY_STATUS_ALL = '__ALL__'

const registryStatusFilterOptions = computed(() => [
  { value: REGISTRY_STATUS_ALL, text: t('common.all') },
  ...contractStatusOptions.map((s) => ({ value: s, text: t(`contracts.contractStatuses.${s}`) })),
])

const registryClientSearchInput = ref('')
const registryClientSuggestOpen = ref(false)
const registryClientSuggestLoading = ref(false)
const registryClientSuggestions = ref<ClientOption[]>([])
let registryClientSearchDebounce: ReturnType<typeof setTimeout> | null = null
let registryClientSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null

const formError = ref<string | null>(null)
const deleteOpen = ref(false)
const deleteLoading = ref(false)
const deleteTarget = ref<{ id: string; contractNumber: string } | null>(null)
const freezeOpen = ref(false)
const freezeLoading = ref(false)
const freezeTargetId = ref<string | null>(null)
const freezeMode = ref<'preset' | 'manual'>('preset')
const freezePreset = ref<7 | 14 | 30>(7)
const freezeForm = reactive({
  startDate: '',
  endDate: '',
  reason: '',
})
const cancelOpen = ref(false)
const cancelLoading = ref(false)
const cancelTarget = ref<{ id: string; contractNumber: string } | null>(null)
const cancelForm = reactive({
  refundAmount: '',
  refundMethod: 'CASH',
  comment: '',
})
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

function applyPrefillFromQuery() {
  const query = route.query
  if (query.newContract === '1' || query.newContract === 'true') {
    return
  }
  const get = (key: string) => {
    const value = query[key]
    return typeof value === 'string' ? value : ''
  }
  form.contractNumber = get('contractNumber')
  form.city = get('city')
  form.firstName = get('firstName')
  form.lastName = get('lastName')
  form.middleName = get('middleName')
  form.birthDate = get('birthDate')
  form.phone = get('phone')
  form.email = get('email')
  form.address = get('address')
  form.clubAddress = get('clubAddress')
  form.passportNumber = get('passportNumber')
  form.passportIssuedBy = get('passportIssuedBy')
  form.passportIssuedAt = get('passportIssuedAt')
  form.serviceName = get('serviceName')
  form.servicePrice = get('servicePrice')
  form.contractDate = get('contractDate')
  form.serviceStartDate = get('serviceStartDate')
  form.serviceEndDate = get('serviceEndDate')
  form.executorName = get('executorName')
  form.executorRepresentative = get('executorRepresentative')
  clientId.value = get('clientId')
}

/** Ключи черновика договора в query — убираем при закрытии модалки, без ПДн в ссылке. */
const CONTRACT_DRAFT_QUERY_KEYS = [
  'clientId',
  'newContract',
  'contractNumber',
  'firstName',
  'lastName',
  'middleName',
  'birthDate',
  'phone',
  'email',
  'address',
  'passportNumber',
  'serviceName',
  'servicePrice',
  'contractDate',
  'serviceStartDate',
  'serviceEndDate',
  'city',
  'clubAddress',
  'passportIssuedBy',
  'passportIssuedAt',
  'executorName',
  'executorRepresentative',
] as const

function stripContractDraftQueryParams() {
  const base = normalizeRouteQuery(route.query)
  for (const k of CONTRACT_DRAFT_QUERY_KEYS) {
    delete base[k]
  }
  if (routeQueryEquals(base, route.query)) return
  void router.replace({ query: base })
}

async function hydrateDraftFromClientApi(cid: string, contractNumberFromQuery?: string) {
  formError.value = null
  try {
    await Promise.all([loadClientOptions(), loadMembershipOptions()])
    const { data } = await api.get(`/clients/${cid}`)
    const row = data as Record<string, unknown>
    clientId.value = cid
    const trimmed = contractNumberFromQuery?.trim()
    form.contractNumber = trimmed && trimmed.length > 0 ? trimmed : generateContractNumber(new Date())
    form.city = ''
    form.firstName = typeof row.firstName === 'string' ? row.firstName : ''
    form.lastName = typeof row.lastName === 'string' ? row.lastName : ''
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
    form.passportIssuedBy = ''
    form.passportIssuedAt = ''
    form.clubAddress = ''
    form.executorName = ''
    form.executorRepresentative = ''
    const mid = row.membershipType != null ? String(row.membershipType) : ''
    selectedMembershipId.value = mid
    syncMembershipFields(mid)
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
  const selected = clientOptions.value.find((item) => item.value === selectedClientId)
  if (!selected) {
    form.firstName = ''
    form.lastName = ''
    form.middleName = ''
    form.phone = ''
    form.email = ''
    form.address = ''
    form.birthDate = ''
    return
  }

  form.firstName = selected.firstName?.trim() || ''
  form.lastName = selected.lastName?.trim() || ''
  form.middleName = selected.middleName?.trim() || ''
  form.phone = selected.phone?.trim() || ''
  form.email = selected.email?.trim() || ''
  form.address = selected.address?.trim() || ''
  form.birthDate = selected.birthDate ? selected.birthDate.slice(0, 10) : ''
}

function syncMembershipFields(selectedId: string) {
  const selected = membershipOptions.value.find((item) => item.value === selectedId)
  if (!selected) {
    form.serviceName = ''
    form.servicePrice = ''
    form.serviceEndDate = ''
    return
  }
  form.serviceName = selected.text
  form.servicePrice = selected.price == null ? '' : String(selected.price)
  syncServiceEndDateByMembership()
}

function parseRegistryStatusFromQuery(raw: string): string {
  if (!raw) return ''
  return contractStatusOptions.includes(raw as (typeof contractStatusOptions)[number]) ? raw : ''
}

function applyRegistryFiltersFromRoute() {
  registryFilters.clientId = typeof route.query.fcClient === 'string' ? route.query.fcClient : ''
  const st = typeof route.query.fcStatus === 'string' ? route.query.fcStatus : ''
  registryFilters.status = parseRegistryStatusFromQuery(st)
  const fromRaw = typeof route.query.fcFrom === 'string' ? route.query.fcFrom.slice(0, 10) : ''
  const toRaw = typeof route.query.fcTo === 'string' ? route.query.fcTo.slice(0, 10) : ''
  registryFilters.from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : ''
  registryFilters.to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : ''
}

function pushRegistryFiltersToUrl() {
  const base = normalizeRouteQuery(route.query)
  const next: Record<string, string> = { ...base }
  for (const k of ['fcClient', 'fcStatus', 'fcFrom', 'fcTo'] as const) {
    delete next[k]
  }
  if (registryFilters.clientId.trim()) next.fcClient = registryFilters.clientId.trim()
  if (registryFilters.status.trim()) next.fcStatus = registryFilters.status.trim()
  if (registryFilters.from.trim()) next.fcFrom = registryFilters.from.trim().slice(0, 10)
  if (registryFilters.to.trim()) next.fcTo = registryFilters.to.trim().slice(0, 10)
  if (routeQueryEquals(next, route.query)) return
  void router.replace({ query: next })
}

function resetContractsRegistryFilters() {
  applyingRegistryFromRoute = true
  registryFilters.clientId = ''
  registryFilters.status = ''
  registryFilters.from = ''
  registryFilters.to = ''
  registryClientSearchInput.value = ''
  registryClientSuggestions.value = []
  registryClientSuggestOpen.value = false
  const base = normalizeRouteQuery(route.query)
  for (const k of ['fcClient', 'fcStatus', 'fcFrom', 'fcTo'] as const) {
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
  async () => {
    applyingRegistryFromRoute = true
    const q = route.query
    const cid = typeof q.clientId === 'string' ? q.clientId : ''
    const isNewContractDraft = q.newContract === '1' || q.newContract === 'true'
    const contractNumberQ = typeof q.contractNumber === 'string' ? q.contractNumber : ''

    if (isNewContractDraft && cid) {
      await hydrateDraftFromClientApi(cid, contractNumberQ || undefined)
      // Менеджер read-only на странице договоров, но генерация из карточки клиента — разрешена API (MANAGER в contracts.controller).
      if (!formError.value) {
        applyDefaultContractDates()
        createContractModalOpen.value = true
      } else {
        createContractModalOpen.value = false
      }
    } else {
      applyPrefillFromQuery()
      createContractModalOpen.value = Boolean(cid) && !isManagerReadOnly.value
      if (createContractModalOpen.value) applyDefaultContractDates()
    }

    applyRegistryFiltersFromRoute()
    syncRegistryClientSearchInputFromFilter()
    void loadContractsRegistry()
    void nextTick(() => {
      applyingRegistryFromRoute = false
    })
  },
  { immediate: true },
)

watch(
  () => [registryFilters.clientId, registryFilters.status, registryFilters.from, registryFilters.to],
  () => {
    if (applyingRegistryFromRoute) return
    pushRegistryFiltersToUrl()
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
  createContractModalOpen,
  async (open) => {
    if (!open) {
      contractBirthPickerOpen.value = false
      unmountContractBirthMask()
      unmountContractPhoneMask()
      unmountContractPassportMask()
      return
    }
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
  applyDefaultContractDates()
  createContractModalOpen.value = true
}

function closeCreateContractModal() {
  if (loadingGenerate.value) return
  clearContractAddressSuggestUi()
  createContractModalOpen.value = false
  stripContractDraftQueryParams()
}

function onCreateContractModalUpdate(open: boolean) {
  if (!open && loadingGenerate.value) return
  if (open && isManagerReadOnly.value && !route.query.newContract) return
  if (!open) clearContractAddressSuggestUi()
  if (open) applyDefaultContractDates()
  createContractModalOpen.value = open
  if (!open) stripContractDraftQueryParams()
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
  }
}

async function loadMoreClientOptions() {
  if (!clientOptionsHasMore.value || loadingMoreClients.value || loadingClients.value) return
  loadingMoreClients.value = true
  try {
    const nextPage = clientOptionsPage.value + 1
    const { data } = await api.get('/clients', {
      params: {
        page: nextPage,
        limit: CLIENT_OPTIONS_PAGE_SIZE,
        sortBy: 'fullName',
        sortOrder: 'asc',
      },
    })
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

async function loadClientOptions() {
  clientOptionsPage.value = 1
  clientOptionsTotal.value = 0
  loadingClients.value = true
  try {
    const { data } = await api.get('/clients', {
      params: {
        page: 1,
        limit: CLIENT_OPTIONS_PAGE_SIZE,
        sortBy: 'fullName',
        sortOrder: 'asc',
      },
    })
    const rows = Array.isArray(data?.items) ? data.items : []
    clientOptionsTotal.value = typeof data?.total === 'number' ? data.total : rows.length
    clientOptions.value = rows.map((item: unknown) =>
      mapClientRowToOption(item as Record<string, unknown>),
    )
    const extraIds = new Set<string>()
    if (clientId.value) extraIds.add(clientId.value)
    if (registryFilters.clientId) extraIds.add(registryFilters.clientId)
    for (const cid of extraIds) {
      if (!cid || clientOptions.value.some((o) => o.value === cid)) continue
      try {
        const { data } = await api.get(`/clients/${cid}`)
        const row = data as Record<string, unknown>
        clientOptions.value.unshift(mapClientRowToOption(row, cid))
      } catch {
        // no-op
      }
    }
    if (clientId.value) {
      syncClientFields(clientId.value)
    }
  } catch {
    clientOptions.value = []
    clientOptionsTotal.value = 0
    clientOptionsPage.value = 1
  } finally {
    loadingClients.value = false
  }
}

async function loadMembershipOptions() {
  loadingMemberships.value = true
  try {
    const { data } = await api.get('/membership-catalog')
    const rows = Array.isArray(data) ? data : []
    membershipOptions.value = rows.map((item: Record<string, unknown>) => ({
      value: String(item.id ?? ''),
      text: String(item.name ?? ''),
      price: item.price == null ? null : Number(item.price),
      durationValue: item.durationValue == null ? null : Number(item.durationValue),
      durationUnit:
        item.durationUnit === 'DAY' ||
        item.durationUnit === 'WEEK' ||
        item.durationUnit === 'MONTH' ||
        item.durationUnit === 'TRIAL'
          ? item.durationUnit
          : null,
    }))
    if (selectedMembershipId.value) {
      syncMembershipFields(selectedMembershipId.value)
    } else if (form.serviceName) {
      const matched = membershipOptions.value.find((item) => item.text === form.serviceName)
      if (matched) {
        selectedMembershipId.value = matched.value
      }
    }
  } catch {
    membershipOptions.value = []
  } finally {
    loadingMemberships.value = false
  }
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

const registryDateRangeModel = computed(() => {
  const hasFrom = Boolean(registryFilters.from)
  const hasTo = Boolean(registryFilters.to)
  if (!hasFrom && !hasTo) return undefined
  return {
    start: hasFrom ? parseDateIso(registryFilters.from) ?? undefined : undefined,
    end: hasTo ? parseDateIso(registryFilters.to) ?? undefined : undefined,
  }
})

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
  if (!form.serviceStartDate) form.serviceStartDate = today
  if (!form.contractNumber.trim()) form.contractNumber = generateContractNumber(new Date())
  syncServiceEndDateByMembership()
}

function payload() {
  const optional = (value: string) => {
    const next = value.trim()
    return next.length > 0 ? next : undefined
  }
  return {
    contractNumber: optional(form.contractNumber),
    city: optional(form.city),
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
    flatten: true,
    extraFields: {},
  }
}

function normalizeTemplateKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fillHtmlTemplateLocally(html: string) {
  const data = payload() as Record<string, unknown>
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(data)) {
    if (key === 'extraFields') continue
    normalized.set(normalizeTemplateKey(key), typeof value === 'string' ? value : String(value ?? ''))
  }
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, rawKey: string) => {
    return escapeHtml(normalized.get(normalizeTemplateKey(rawKey)) ?? '')
  })
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

async function requestHtml(): Promise<string> {
  const { data } = await api.post('/contracts/render-html', payload(), {
    responseType: 'text',
    headers: { Accept: 'text/html' },
  })
  return String(data)
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

async function printFromHtml() {
  loadingGenerate.value = true
  formError.value = null
  try {
    const html = fillHtmlTemplateLocally(await requestHtml())
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      formError.value = t('contracts.popupBlocked')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
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
    formError.value = t('contracts.clientRequiredForSave')
    return
  }
  if (!selectedMembershipId.value.trim()) {
    formError.value = t('contracts.membershipRequiredForSave')
    return
  }
  if (!form.servicePrice.trim()) {
    formError.value = t('contracts.servicePriceRequired')
    return
  }
  loadingGenerate.value = true
  formError.value = null
  try {
    const { data } = await api.post(`/contracts/client/${clientId.value.trim()}/save`, payload(), {
      responseType: 'blob',
    })
    const blob = data instanceof Blob ? data : new Blob([data])
    if (!blob.type.includes('pdf')) {
      throw new Error('PDF response expected')
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contract-${form.contractNumber || 'saved'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
    notify({ color: 'success', message: t('contracts.saved') })
    clearContractAddressSuggestUi()
    createContractModalOpen.value = false
    stripContractDraftQueryParams()
    await loadContractsRegistry()
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('contracts.saveFailed'),
      byCode: {
        ACTIVE_CONTRACT_EXISTS: t('clients.activeContractAlreadyExists'),
        CONTRACT_NUMBER_EXISTS: t('clients.contractNumberTaken'),
        CONTRACT_NUMBER_REQUIRED: t('clients.contractNumberRequired'),
        SERVICE_PRICE_REQUIRED: t('contracts.servicePriceRequired'),
        SERVICE_DATE_RANGE_INVALID: t('contracts.saveFailed'),
      },
    })
  } finally {
    loadingGenerate.value = false
  }
}

async function loadContractsRegistry() {
  registryPage.value = 1
  loadingRegistry.value = true
  try {
    const { data } = await api.get('/contracts', { params: registryFilters })
    contractsRegistry.value = Array.isArray(data) ? data : []
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

function askFreezeContract(contractId: string) {
  freezeTargetId.value = contractId
  freezeMode.value = 'preset'
  freezePreset.value = 7
  freezeForm.startDate = ''
  freezeForm.endDate = ''
  freezeForm.reason = ''
  freezeOpen.value = true
}

async function submitFreezeContract() {
  if (!freezeTargetId.value) return
  freezeLoading.value = true
  try {
    const payload =
      freezeMode.value === 'manual'
        ? {
            startDate: freezeForm.startDate || undefined,
            endDate: freezeForm.endDate || undefined,
            reason: freezeForm.reason.trim() || undefined,
          }
        : {
            durationDays: freezePreset.value,
            reason: freezeForm.reason.trim() || undefined,
          }
    await api.patch(`/contracts/${freezeTargetId.value}/pause`, payload)
    freezeOpen.value = false
    freezeTargetId.value = null
    await loadContractsRegistry()
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, {
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

async function resumeContract(contractId: string) {
  try {
    await api.patch(`/contracts/${contractId}/resume`)
    await loadContractsRegistry()
  } catch (e: unknown) {
    formError.value = resolveApiErrorMessage(e, { defaultMessage: t('contracts.statusUpdateFailed') })
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

function applyContractStatusFilter(status: string) {
  registryFilters.status = status
}

function registryClientLabelById(id: string): string {
  const o = clientOptions.value.find((c) => c.value === id)
  return o?.text ?? ''
}

function syncRegistryClientSearchInputFromFilter() {
  if (!registryFilters.clientId) {
    registryClientSearchInput.value = ''
    return
  }
  const label = registryClientLabelById(registryFilters.clientId)
  if (label) registryClientSearchInput.value = label
}

watch(
  [() => registryFilters.clientId, clientOptions],
  () => {
    syncRegistryClientSearchInputFromFilter()
  },
  { immediate: true },
)

async function fetchRegistryClientSuggestions(query: string) {
  const q = query.trim()
  if (q.length < 2) {
    registryClientSuggestions.value = []
    return
  }
  registryClientSuggestLoading.value = true
  try {
    const { data } = await api.get('/clients', {
      params: { page: 1, limit: 30, search: q, sortBy: 'fullName', sortOrder: 'asc' },
    })
    const rows = Array.isArray(data?.items) ? data.items : []
    registryClientSuggestions.value = rows.map((item: Record<string, unknown>) => {
      const firstName = typeof item.firstName === 'string' ? item.firstName : ''
      const lastName = typeof item.lastName === 'string' ? item.lastName : ''
      const middleName = typeof item.middleName === 'string' ? item.middleName : ''
      const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ').trim()
      const phone = typeof item.phone === 'string' ? item.phone : ''
      return {
        value: String(item.id ?? ''),
        text: fullName || phone || String(item.id ?? ''),
        firstName,
        lastName,
        middleName,
        phone,
        email: typeof item.email === 'string' ? item.email : '',
        address: typeof item.address === 'string' ? item.address : '',
        birthDate: typeof item.birthDate === 'string' ? item.birthDate : null,
      }
    })
  } catch {
    registryClientSuggestions.value = []
  } finally {
    registryClientSuggestLoading.value = false
  }
}

function onRegistryClientSearchInput(value: unknown) {
  const str = typeof value === 'string' ? value : ''
  registryClientSearchInput.value = str
  if (!str.trim()) {
    registryFilters.clientId = ''
    registryClientSuggestions.value = []
    registryClientSuggestOpen.value = false
    return
  }
  if (registryFilters.clientId) {
    const label = registryClientLabelById(registryFilters.clientId)
    if (str.trim() !== label.trim()) {
      registryFilters.clientId = ''
    }
  }
  if (registryClientSearchDebounce) clearTimeout(registryClientSearchDebounce)
  registryClientSearchDebounce = setTimeout(() => {
    void fetchRegistryClientSuggestions(str).then(() => {
      registryClientSuggestOpen.value = str.trim().length >= 2 && registryClientSuggestions.value.length > 0
    })
  }, 320)
}

function onRegistryClientSearchFocus() {
  const str = registryClientSearchInput.value.trim()
  if (str.length >= 2) {
    void fetchRegistryClientSuggestions(str).then(() => {
      registryClientSuggestOpen.value = registryClientSuggestions.value.length > 0
    })
  }
}

function onRegistryClientSearchBlur() {
  if (registryClientSuggestBlurTimer) clearTimeout(registryClientSuggestBlurTimer)
  registryClientSuggestBlurTimer = setTimeout(() => {
    registryClientSuggestOpen.value = false
  }, 200)
}

function pickRegistryClient(opt: ClientOption) {
  registryFilters.clientId = opt.value
  registryClientSearchInput.value = opt.text
  registryClientSuggestOpen.value = false
  registryClientSuggestions.value = []
}

function onRegistryStatusFilter(value: unknown) {
  const v = typeof value === 'string' ? value : ''
  registryFilters.status = v === REGISTRY_STATUS_ALL || v === '' ? '' : v
}

function onRegistryDateRange(value: unknown) {
  if (value == null || value === '' || value === false) {
    registryFilters.from = ''
    registryFilters.to = ''
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    registryFilters.from = a != null && a !== '' ? toIsoDate(a) : ''
    registryFilters.to = b != null && b !== '' ? toIsoDate(b) : ''
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    registryFilters.from = r.start != null && r.start !== '' ? toIsoDate(r.start) : ''
    registryFilters.to = r.end != null && r.end !== '' ? toIsoDate(r.end) : ''
  }
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

onMounted(() => {
  document.addEventListener('pointerdown', onContractBirthPickerPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onContractBirthPickerPointerDown, true)
  unmountContractPhoneMask()
  unmountContractPassportMask()
  if (registryClientSearchDebounce) clearTimeout(registryClientSearchDebounce)
  if (registryClientSuggestBlurTimer) clearTimeout(registryClientSuggestBlurTimer)
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
        <AppListFiltersToolbar :loading="loadingRegistry">
          <div class="contracts-registry-filters">
            <div class="address-autocomplete contracts-client-search" @keydown.stop>
              <VaInput
                :model-value="registryClientSearchInput"
                :label="t('contracts.filterClient')"
                icon="search"
                clearable
                :loading="registryClientSuggestLoading"
                autocomplete="off"
                @update:model-value="onRegistryClientSearchInput"
                @focus="onRegistryClientSearchFocus"
                @blur="onRegistryClientSearchBlur"
              />
              <div
                v-if="registryClientSuggestOpen && registryClientSuggestions.length > 0"
                class="address-autocomplete__menu"
                role="listbox"
              >
                <button
                  v-for="opt in registryClientSuggestions"
                  :key="opt.value"
                  type="button"
                  class="address-autocomplete__item"
                  role="option"
                  @mousedown.prevent="pickRegistryClient(opt)"
                >
                  {{ opt.text }}
                </button>
              </div>
            </div>
            <VaSelect
              :model-value="registryFilters.status === '' ? REGISTRY_STATUS_ALL : registryFilters.status"
              :label="t('contracts.filterStatus')"
              :options="registryStatusFilterOptions"
              text-by="text"
              value-by="value"
              @update:model-value="onRegistryStatusFilter"
            />
            <VaDateInput
              mode="range"
              :model-value="registryDateRangeModel"
              :label="t('contracts.filterDateRange')"
              clearable
              @update:model-value="onRegistryDateRange"
            />
          </div>
          <template #actions>
            <VaButton
              size="small"
              preset="secondary"
              icon="close"
              :disabled="
                !registryFilters.clientId &&
                !registryFilters.status &&
                !registryFilters.from &&
                !registryFilters.to
              "
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

      <div class="contracts-registry-presets-row">
        <VaButton
          size="small"
          :preset="registryFilters.status === '' ? 'primary' : 'secondary'"
          @click="applyContractStatusFilter('')"
        >
          {{ t('common.all') }}
        </VaButton>
        <VaButton
          v-for="status in contractStatusOptions"
          :key="status"
          size="small"
          :preset="registryFilters.status === status ? 'primary' : 'secondary'"
          @click="applyContractStatusFilter(status)"
        >
          {{ contractStatusLabel(status) }}
        </VaButton>
      </div>

      <AppDataTableShell
        :loading="loadingRegistry"
        :has-items="hasRegistryItems"
        :show-pager="hasRegistryItems && registryPageCount > 1"
      >
        <VaDataTable
          class="app-table-actions-last-col"
          :items="pagedContractsRegistry"
          :loading="loadingRegistry"
          :columns="[
            { key: 'contractNumber', label: t('contracts.contractNumber') },
            { key: 'client', label: t('clients.title') },
            { key: 'status', label: t('clients.statusLabel') },
            { key: 'servicePrice', label: t('contracts.servicePrice') },
            { key: 'createdAt', label: t('contracts.contractDate') },
            { key: 'actions', label: t('clients.actions') },
          ]"
        >
          <template #cell(client)="{ rowData }">
            {{ [rowData.client?.lastName, rowData.client?.firstName, rowData.client?.middleName].filter(Boolean).join(' ') || '—' }}
          </template>
          <template #cell(servicePrice)="{ rowData }">
            {{ rowData.servicePrice == null ? '—' : Number(rowData.servicePrice).toFixed(2) }}
          </template>
          <template #cell(createdAt)="{ rowData }">
            {{ new Date(rowData.createdAt).toLocaleString('ru-RU') }}
          </template>
          <template #cell(status)="{ rowData }">
            <StatusBadge
              :label="contractStatusLabel(rowData.status || 'ACTIVE')"
              :tone="contractStatusTone(rowData.status || 'ACTIVE')"
            />
          </template>
          <template #cell(actions)="{ rowData }">
            <div class="app-actions-cell">
              <VaButton
                v-if="!isManagerReadOnly && rowData.status === 'ACTIVE'"
                size="large"
                preset="plain"
                :icon="TableActionIcon.contractPause"
                :aria-label="t('contracts.pause')"
                :title="t('contracts.pause')"
                @click="askFreezeContract(rowData.id)"
              />
              <VaButton
                v-if="!isManagerReadOnly && rowData.status === 'PAUSED'"
                size="large"
                preset="plain"
                :icon="TableActionIcon.contractResume"
                :aria-label="t('contracts.resume')"
                :title="t('contracts.resume')"
                @click="resumeContract(rowData.id)"
              />
              <VaButton
                v-if="!isManagerReadOnly && rowData.status !== 'CANCELLED' && rowData.status !== 'EXPIRED'"
                size="large"
                color="warning"
                preset="plain"
                :icon="TableActionIcon.contractTerminate"
                :aria-label="t('contracts.terminate')"
                :title="t('contracts.terminate')"
                @click="askCancelContract(rowData)"
              />
              <VaButton
                size="large"
                preset="plain"
                :icon="TableActionIcon.openExternal"
                :aria-label="t('contracts.openSaved')"
                :disabled="!rowData.s3Url"
                :title="t('contracts.openSaved')"
                @click="openSavedContract(rowData.id)"
              />
              <VaButton
                v-if="!isManagerReadOnly"
                size="large"
                color="danger"
                preset="plain"
                :icon="TableActionIcon.delete"
                :aria-label="t('contracts.delete')"
                :title="t('contracts.delete')"
                @click="askDeleteContract(rowData)"
              />
            </div>
          </template>
        </VaDataTable>
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

    <VaModal
      :model-value="createContractModalOpen"
      hide-default-actions
      fixed-layout
      max-width="min(95vw, 900px)"
      @update:model-value="onCreateContractModalUpdate"
    >
      <template #header />
      <div class="contract-create-modal app-modal-form" @keydown="onFormTabKeydown">
        <AppSectionCard :title="t('contracts.formTitle')" :subtitle="t('contracts.formHint')">
          <div class="contracts-form-grid">
            <VaSelect
              :model-value="clientId"
              class="contracts-form-grid__full"
              :label="t('contracts.clientSelect')"
              :options="clientOptions"
              :loading="loadingClients"
              text-by="text"
              value-by="value"
              searchable
              clearable
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
                  @click.stop="regenerateContractNumber"
                />
              </template>
            </VaInput>
            <VaInput v-model="form.city" :label="t('contracts.city')" />
            <VaInput v-model="form.lastName" :label="t('contracts.lastName')" />
            <VaInput v-model="form.firstName" :label="t('contracts.firstName')" />
            <VaInput v-model="form.middleName" :label="t('contracts.middleName')" />
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
            <VaInput v-model="form.email" :label="t('contracts.email')" />
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
            <VaSelect
              :model-value="selectedMembershipId"
              :label="t('contracts.serviceName')"
              :options="membershipOptions"
              :loading="loadingMemberships"
              text-by="text"
              value-by="value"
              searchable
              clearable
              @update:model-value="(value) => (selectedMembershipId = typeof value === 'string' ? value : '')"
            />
            <VaInput
              v-model="form.servicePrice"
              :label="`${t('contracts.servicePrice')} *`"
              readonly
              :error="!form.servicePrice.trim() && Boolean(formError)"
            />
            <VaDateInput
              :model-value="form.contractDate || undefined"
              :label="t('contracts.contractDate')"
              @update:model-value="form.contractDate = toIsoDate($event)"
            />
            <VaDateInput
              :model-value="form.serviceStartDate || undefined"
              :label="t('contracts.serviceStartDate')"
              @update:model-value="form.serviceStartDate = toIsoDate($event)"
            />
            <VaDateInput
              :model-value="form.serviceEndDate || undefined"
              :label="t('contracts.serviceEndDate')"
              readonly
            />
            <VaInput v-model="form.executorName" :label="t('contracts.executorName')" />
            <VaInput v-model="form.executorRepresentative" :label="t('contracts.executorRepresentative')" />
          </div>
        </AppSectionCard>

        <VaAlert v-if="formError" color="danger" outline class="contracts-error">
          {{ formError }}
        </VaAlert>

        <div class="contracts-modal-toolbar">
          <VaButton :loading="loadingGenerate" icon="download" @click="generateDownload">
            {{ t('contracts.download') }}
          </VaButton>
          <VaButton preset="secondary" :loading="loadingGenerate" icon="print" @click="generatePrint">
            {{ t('contracts.print') }}
          </VaButton>
          <VaButton preset="secondary" :loading="loadingGenerate" icon="article" @click="printFromHtml">
            {{ t('contracts.printHtml') }}
          </VaButton>
        </div>

        <div class="app-modal-actions">
          <VaButton type="button" preset="secondary" :disabled="loadingGenerate" @click="closeCreateContractModal">
            {{ t('common.cancel') }}
          </VaButton>
          <VaButton type="button" color="primary" :loading="loadingGenerate" icon="save" @click="saveContract">
            {{ t('contracts.save') }}
          </VaButton>
        </div>
      </div>
    </VaModal>

    <VaModal v-model="freezeOpen" hide-default-actions fixed-layout max-width="520px">
      <h3 class="modal-title">{{ t('contracts.freezeTitle') }}</h3>
      <div class="contracts-form-grid">
        <VaSelect
          v-model="freezeMode"
          :label="t('contracts.freezeMode')"
          :options="[
            { value: 'preset', text: t('contracts.freezePresetMode') },
            { value: 'manual', text: t('contracts.freezeManualMode') },
          ]"
          value-by="value"
          text-by="text"
          class="contracts-form-grid__full"
        />
        <VaSelect
          v-if="freezeMode === 'preset'"
          v-model="freezePreset"
          :label="t('contracts.freezeDuration')"
          :options="[
            { value: 7, text: t('contracts.freezePreset7') },
            { value: 14, text: t('contracts.freezePreset14') },
            { value: 30, text: t('contracts.freezePreset30') },
          ]"
          value-by="value"
          text-by="text"
          class="contracts-form-grid__full"
        />
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
        <VaInput v-model="freezeForm.reason" :label="t('contracts.freezeReason')" class="contracts-form-grid__full" />
      </div>
      <div class="contracts-actions contracts-actions--bottom app-modal-actions">
        <VaButton preset="secondary" @click="freezeOpen = false">{{ t('common.cancel') }}</VaButton>
        <VaButton :loading="freezeLoading" @click="submitFreezeContract">{{ t('contracts.pause') }}</VaButton>
      </div>
    </VaModal>

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

.contracts-registry-filters {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(11rem, 1.35fr) minmax(9rem, 0.95fr) minmax(13rem, 1.55fr);
  gap: 0.75rem;
  align-items: end;
}

.contracts-registry-presets-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.35rem 0 0.15rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
  margin-top: 0.05rem;
}

@media (max-width: 960px) {
  .contracts-registry-filters {
    grid-template-columns: 1fr;
  }
}

.contract-create-modal {
  display: flex;
  flex-direction: column;
  gap: var(--app-section-gap);
  min-width: 0;
}

.contracts-modal-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
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
  .contracts-form-grid {
    grid-template-columns: 1fr;
  }

  .contracts-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .contracts-actions :deep(.va-button) {
    width: 100%;
    min-width: 0;
  }
}
</style>
