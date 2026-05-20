<script setup lang="ts">
import IMask, { type InputMask } from 'imask'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { TableActionIcon } from '@/config/tableActionIcons'
import { DEFAULT_TABLE_PAGE_LIMIT } from '@/config/tablePagination'
import type { ClientForm, ClientStatus } from '@/types/clients'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppTablePagerRow from '@/components/ui/AppTablePagerRow.vue'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { api } from '@/utils/api'
import { copyTextToClipboard } from '@/utils/clipboard'
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
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'
import { meaningfulAlertText } from '@/utils/meaningfulAlertText'
import type { ClientEditTab } from '@/composables/useClientsListUrlSync'

const props = defineProps<{
  modelValue: ClientForm
  attempted: boolean
  isCreateMode?: boolean
  statusOptions: Array<{ value: ClientStatus; text: string }>
  membershipOptions: Array<{ value: string; text: string }>
  currentManagerName: string
  cardNumberChecking?: boolean
  cardNumberTaken?: boolean
  contractHistory?: Array<{
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
  }>
  contractHistoryLoading?: boolean
  paymentsHistory?: Array<{
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
  paymentsLoading?: boolean
  visitsHistory?: Array<{
    id: string
    lockerNumber: string
    enteredAt: string
    exitedAt: string | null
    status: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED'
    closeReason?: string | null
    comment?: string | null
    exitedBy?: { firstName?: string | null; lastName?: string | null; login?: string } | null
  }>
  visitsLoading?: boolean
  visitsPage?: number
  visitsLimit?: number
  visitsTotal?: number
  visitsFrom?: string
  visitsTo?: string
  /** При сохранении платежа по договору с родителя — блокировка кнопки. */
  addingContractPayment?: boolean
  /** Активная вкладка (редактирование клиента; синхронизируется с URL). */
  activeTab?: ClientEditTab
  /** Если задан — загрузка фото идёт в `clients/:id/…`; иначе в `clients/pending/…` (создание клиента). */
  photoUploadClientId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ClientForm): void
  (e: 'generate-contract-number'): void
  (e: 'open-contract-history-item', id: string): void
  (e: 'activate-contract-history-item', id: string): void
  (e: 'pause-contract-history-item', id: string): void
  (e: 'resume-contract-history-item', id: string): void
  (e: 'terminate-contract-history-item', id: string): void
  (e: 'add-contract-payment', value: {
    contractDocumentId: string
    amount: number
    paidAt: string
    channel: 'CASH' | 'NON_CASH'
  }): void
  (e: 'visits-tab-open'): void
  (e: 'update:visitsPage', value: number): void
  (e: 'update:visitsLimit', value: number): void
  (e: 'update:visitsFrom', value: string): void
  (e: 'update:visitsTo', value: string): void
  (e: 'visits-reset-filters'): void
  (e: 'photo-draft-changed', pending: boolean): void
  (e: 'update:activeTab', value: ClientEditTab): void
}>()
const { t, locale } = useI18n()
const { init: notify } = useToast()
const rootRef = ref<HTMLElement | null>(null)
const phoneFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const birthFieldWrapRef = ref<HTMLElement | null>(null)
const birthTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const birthTextValue = ref('')
const birthPickerOpen = ref(false)
const contractStartFieldWrapRef = ref<HTMLElement | null>(null)
const contractStartTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const contractStartTextValue = ref('')
const contractStartPickerOpen = ref(false)
const contractEndFieldWrapRef = ref<HTMLElement | null>(null)
const contractEndTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const contractEndTextValue = ref('')
const contractEndPickerOpen = ref(false)
const paymentFieldWrapRef = ref<HTMLElement | null>(null)
const paymentTextFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
const paymentTextValue = ref('')
const paymentPickerOpen = ref(false)
const passportFieldRef = ref<ComponentPublicInstance | HTMLElement | null>(null)
let phoneMask: InputMask<{ mask: string }> | null = null
let birthMask: InputMask<{ mask: string }> | null = null
let passportMask: InputMask<{ mask: string }> | null = null
let contractStartTextMask: InputMask<{ mask: string }> | null = null
let contractEndTextMask: InputMask<{ mask: string }> | null = null
let paymentTextMask: InputMask<{ mask: string }> | null = null
const addressSuggestions = ref<string[]>([])
const addressSuggestLoading = ref(false)
const addressSuggestOpen = ref(false)
let addressSuggestTimer: ReturnType<typeof setTimeout> | null = null
let addressSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null

function patch<K extends keyof ClientForm>(key: K, value: ClientForm[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

async function loadAddressSuggestions(query: string) {
  const normalized = query.trim()
  if (normalized.length < 3) {
    addressSuggestions.value = []
    addressSuggestLoading.value = false
    return
  }
  addressSuggestLoading.value = true
  try {
    const { data } = await api.get<string[]>('/clients/address-suggestions', {
      params: { query: normalized },
    })
    addressSuggestions.value = Array.isArray(data) ? data : []
    addressSuggestOpen.value = addressSuggestions.value.length > 0
  } catch {
    addressSuggestions.value = []
  } finally {
    addressSuggestLoading.value = false
  }
}

function onAddressInput(value: string) {
  patch('address', value)
  if (addressSuggestTimer) clearTimeout(addressSuggestTimer)
  addressSuggestTimer = setTimeout(() => {
    void loadAddressSuggestions(value)
  }, 260)
}

function onAddressFocus() {
  if (addressSuggestBlurTimer) {
    clearTimeout(addressSuggestBlurTimer)
    addressSuggestBlurTimer = null
  }
  addressSuggestOpen.value = addressSuggestions.value.length > 0
}

function onAddressBlur() {
  addressSuggestBlurTimer = setTimeout(() => {
    addressSuggestOpen.value = false
  }, 120)
}

function selectAddressSuggestion(value: string) {
  patch('address', value)
  addressSuggestOpen.value = false
}

const REQUIRED_FIELDS: Array<keyof Pick<ClientForm, 'firstName' | 'lastName' | 'phone'>> = [
  'lastName',
  'firstName',
  'phone',
]

function requiredError(field: 'firstName' | 'lastName' | 'phone') {
  if (!props.attempted) return false
  if (field === 'phone') {
    const digits = props.modelValue.phone.replace(/\D/g, '')
    return digits.length < 11
  }
  return !props.modelValue[field].trim()
}

const requiredCompleted = computed(() =>
  REQUIRED_FIELDS.filter((field) => props.modelValue[field].trim().length > 0).length,
)

const touched = ref({
  email: false,
  cardNumber: false,
})
const dateErrors = ref({
  birthDate: false,
  contractStartDate: false,
  contractEndDate: false,
  paymentDate: false,
})

const emailInvalid = computed(() => {
  const value = props.modelValue.email.trim()
  if (!value) return false
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
})

const cardNumberInvalid = computed(() => {
  const value = props.modelValue.cardNumber.trim()
  if (!value) return false
  return !/^[A-Za-z0-9\-]{3,80}$/.test(value)
})

const showEmailError = computed(
  () => (props.attempted || touched.value.email) && emailInvalid.value,
)

const showCardNumberError = computed(
  () =>
    (props.attempted || touched.value.cardNumber) &&
    (cardNumberInvalid.value || Boolean(props.cardNumberTaken)),
)
const GENDER_UNSET_VALUE = '__UNSPECIFIED__'

function contractStatusTone(status?: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'PAUSED') return 'warning'
  if (status === 'CANCELLED') return 'danger'
  if (status === 'EXPIRED') return 'neutral'
  return 'info'
}

function paymentHistoryStatusLabel(status?: string): string {
  const s = (status || '').trim().toUpperCase()
  if (s === 'REFUND') return t('contracts.paymentStatuses.REFUNDED')
  const key = s === 'PENDING' || s === 'PAID' || s === 'REFUNDED' ? s : null
  return key ? t(`contracts.paymentStatuses.${key}`) : (status?.trim() || '—')
}

function paymentChannelLabel(channel?: string | null): string {
  const c = (channel || 'CASH').trim().toUpperCase()
  return c === 'NON_CASH' ? t('clients.paymentChannelNonCash') : t('clients.paymentChannelCash')
}

function paymentHistoryStatusTone(status?: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = (status || '').trim().toUpperCase()
  if (s === 'PAID') return 'success'
  if (s === 'REFUNDED' || s === 'REFUND') return 'warning'
  if (s === 'PENDING') return 'info'
  return 'neutral'
}

const contractsWithOutstandingBalance = computed(() => {
  const list = props.contractHistory ?? []
  return list.filter((c) => {
    if (c.status !== 'ACTIVE' && c.status !== 'PAUSED') return false
    if (c.fullyPaid === true) return false
    const bal = Number(String(c.balanceDue ?? '0').replace(',', '.'))
    return Number.isFinite(bal) && bal > 0.001
  })
})

const addPaymentContractOptions = computed(() =>
  contractsWithOutstandingBalance.value.map((c) => ({
    value: c.id,
    text: `${c.contractNumber || '—'} · ${Number(String(c.balanceDue).replace(',', '.')).toFixed(2)}`,
  })),
)

const addPaymentContractId = ref('')
const addPaymentAmount = ref('')
const addPaymentPaidAt = ref(formatIsoDate(new Date()))
const addPaymentChannel = ref<'CASH' | 'NON_CASH'>('CASH')

watch(
  contractsWithOutstandingBalance,
  (list) => {
    if (!list.length) {
      addPaymentContractId.value = ''
      return
    }
    if (!list.some((c) => c.id === addPaymentContractId.value)) {
      addPaymentContractId.value = list[0]?.id ?? ''
    }
  },
  { immediate: true },
)

function paymentPlanShortLabel(plan?: string): string {
  if (plan === 'INSTALLMENT_FLEXIBLE' || plan === 'INSTALLMENT_EQUAL') {
    return t('clients.paymentPlanShortINSTALLMENT')
  }
  if (plan === 'FULL') return t('clients.paymentPlanShortFULL')
  return plan ?? ''
}

function contractShowsUnderpaidNote(item: {
  status?: string
  fullyPaid?: boolean
  balanceDue?: string | null
}): boolean {
  if (item.status !== 'ACTIVE' && item.status !== 'PAUSED') return false
  if (item.fullyPaid === true) return false
  const bal = Number(String(item.balanceDue ?? '0').replace(',', '.'))
  return Number.isFinite(bal) && bal > 0.001
}

function submitAddContractPayment() {
  if (props.addingContractPayment) return
  const cid = addPaymentContractId.value
  if (!cid) return
  const amount = Number(addPaymentAmount.value.replace(',', '.'))
  if (!Number.isFinite(amount) || amount < 0.01) {
    notify({ color: 'warning', message: t('clients.invalidPaymentAmount') })
    return
  }
  const paidAt = addPaymentPaidAt.value.trim()
  if (!paidAt) {
    notify({ color: 'warning', message: t('clients.invalidPaymentDate') })
    return
  }
  emit('add-contract-payment', {
    contractDocumentId: cid,
    amount,
    paidAt,
    channel: addPaymentChannel.value,
  })
  addPaymentAmount.value = ''
}

const MAX_PHOTO_MB = 8
const photoUploading = ref(false)
const photoUploadError = ref<string | null>(null)
/** Выбранный файл — превью сразу, в S3 только по «Сохранить». */
const pendingPhotoFile = ref<File | null>(null)
const pendingPhotoPreviewUrl = ref<string | null>(null)
const photoCameraOpen = ref(false)
const photoRemoveConfirmOpen = ref(false)
const photoViewerOpen = ref(false)
const photoFileInputRef = ref<HTMLInputElement | null>(null)
const cameraVideoRef = ref<HTMLVideoElement | null>(null)
const cameraStream = ref<MediaStream | null>(null)
/** Ссылка в БД есть, но <img> не смог загрузить (404/403/CORS к объекту и т.д.). */
const avatarLoadFailed = ref(false)

const safeAvatarSrc = computed(() => clientPhotoDisplayUrl(props.modelValue.photoUrl))

const showPhotoPreviewImg = computed(
  () => Boolean(pendingPhotoPreviewUrl.value) || (Boolean(safeAvatarSrc.value) && !avatarLoadFailed.value),
)

const photoPreviewSrc = computed(() => pendingPhotoPreviewUrl.value || safeAvatarSrc.value || '')

const photoErrorBanner = computed(() => meaningfulAlertText(photoUploadError.value))

function resetPendingPhotoFile() {
  if (pendingPhotoPreviewUrl.value) {
    URL.revokeObjectURL(pendingPhotoPreviewUrl.value)
    pendingPhotoPreviewUrl.value = null
  }
  pendingPhotoFile.value = null
}

function stopCameraStream() {
  const s = cameraStream.value
  if (s) {
    for (const track of s.getTracks()) {
      track.stop()
    }
    cameraStream.value = null
  }
  const v = cameraVideoRef.value
  if (v) v.srcObject = null
}

function applyPhotoDraftFromFile(file: File, input: HTMLInputElement | null | undefined) {
  photoUploadError.value = null
  if (!file.type.startsWith('image/')) {
    photoUploadError.value = t('clients.photoUnsupportedType')
    if (input) input.value = ''
    return
  }
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
    photoUploadError.value = t('clients.photoTooLarge', { max: MAX_PHOTO_MB })
    if (input) input.value = ''
    return
  }
  resetPendingPhotoFile()
  pendingPhotoFile.value = file
  pendingPhotoPreviewUrl.value = URL.createObjectURL(file)
  if (input) input.value = ''
}

watch(photoCameraOpen, async (open) => {
  if (!open) {
    stopCameraStream()
    return
  }
  photoUploadError.value = null
  await nextTick()
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  if (!navigator.mediaDevices?.getUserMedia) {
    photoUploadError.value = t('clients.photoCameraUnsupported')
    photoCameraOpen.value = false
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    })
    cameraStream.value = stream
    const el = cameraVideoRef.value
    if (!el) {
      stopCameraStream()
      photoCameraOpen.value = false
      return
    }
    el.srcObject = stream
    await el.play()
  } catch (e: unknown) {
    stopCameraStream()
    photoCameraOpen.value = false
    const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      photoUploadError.value = t('clients.photoCameraDenied')
    } else {
      photoUploadError.value = t('clients.photoCameraFailed')
    }
  }
}, { flush: 'post' })

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  })
}

async function confirmPhotoCameraCapture() {
  const video = cameraVideoRef.value
  if (!video || video.videoWidth < 2 || video.videoHeight < 2) return

  const vw = video.videoWidth
  const vh = video.videoHeight
  const maxEdge = 1920
  let tw = vw
  let th = vh
  if (Math.max(tw, th) > maxEdge) {
    if (tw >= th) {
      th = Math.round((vh * maxEdge) / vw)
      tw = maxEdge
    } else {
      tw = Math.round((vw * maxEdge) / vh)
      th = maxEdge
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(video, 0, 0, tw, th)

  let quality = 0.92
  let blob = await canvasToJpegBlob(canvas, quality)
  while (blob && blob.size > MAX_PHOTO_MB * 1024 * 1024 && quality > 0.45) {
    quality -= 0.07
    blob = await canvasToJpegBlob(canvas, quality)
  }
  if (!blob || blob.size > MAX_PHOTO_MB * 1024 * 1024) {
    photoUploadError.value = t('clients.photoTooLarge', { max: MAX_PHOTO_MB })
    return
  }

  const file = new File([blob], 'camera.jpg', { type: 'image/jpeg' })
  stopCameraStream()
  photoCameraOpen.value = false
  applyPhotoDraftFromFile(file, undefined)
}

function cancelPhotoCamera() {
  photoCameraOpen.value = false
}

function resetPhotoDraft() {
  photoUploadError.value = null
  avatarLoadFailed.value = false
  photoCameraOpen.value = false
  stopCameraStream()
  resetPendingPhotoFile()
}

watch(pendingPhotoFile, (f) => {
  emit('photo-draft-changed', f != null)
})

watch(
  () => props.modelValue.photoUrl,
  () => {
    avatarLoadFailed.value = false
  },
)

function onPhotoSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return
  applyPhotoDraftFromFile(file, input ?? undefined)
}

/** Вызов перед POST/PATCH клиента: загрузка выбранного фото в хранилище и запись public URL в форму. */
async function flushPendingPhotoUpload(): Promise<boolean> {
  const file = pendingPhotoFile.value
  if (!file) return true
  photoUploadError.value = null
  photoUploading.value = true
  try {
    const cid = props.photoUploadClientId?.trim()
    const path = cid ? `/clients/${cid}/photo/upload-url` : '/clients/photo/upload-url'
    const { data } = await api.post<{ uploadUrl: string; publicUrl: string }>(path, {
      contentType: file.type,
    })
    const putRes = await fetch(data.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!putRes.ok) {
      throw new Error(`HTTP ${putRes.status}`)
    }
    resetPendingPhotoFile()
    patch('photoUrl', data.publicUrl)
    return true
  } catch (e: unknown) {
    photoUploadError.value = resolveApiErrorMessage(e, {
      defaultMessage: t('clients.photoUploadFailed'),
      byCode: {
        STORAGE_NOT_CONFIGURED: t('clients.photoStorageNotConfigured'),
        STORAGE_PUBLIC_URL_REQUIRED: t('clients.photoPublicUrlRequired'),
        UNSUPPORTED_IMAGE_TYPE: t('clients.photoUnsupportedType'),
        PHOTO_DATA_URL_NOT_ALLOWED: t('clients.photoDataUrlNotAllowed'),
      },
    })
    return false
  } finally {
    photoUploading.value = false
  }
}

function onPhotoPreviewImgError() {
  if (pendingPhotoPreviewUrl.value) return
  avatarLoadFailed.value = true
}

const internalActiveTab = ref<ClientEditTab>('general')

const activeTab = computed({
  get(): ClientEditTab {
    return props.activeTab ?? internalActiveTab.value
  },
  set(value: ClientEditTab) {
    if (props.activeTab !== undefined) {
      emit('update:activeTab', value)
    } else {
      internalActiveTab.value = value
    }
  },
})

/** На узком экране — один селект вместо горизонтальных табов. */
const MOBILE_TAB_SELECT_MQ = '(max-width: 640px)'
const mobileTabSelect = ref(false)
let tabSelectMq: MediaQueryList | null = null
let tabSelectListener: ((e: MediaQueryListEvent) => void) | null = null

const clientFormTabs = computed(() => [
  { value: 'general' as const, text: t('clients.tabGeneral'), icon: 'person' },
  { value: 'payments' as const, text: t('clients.tabPayments'), icon: 'payments' },
  { value: 'visits' as const, text: t('clients.tabVisits'), icon: 'directions_walk' },
  { value: 'history' as const, text: t('clients.tabHistory'), icon: 'description' },
])

const tabSelectOptions = computed(() =>
  clientFormTabs.value.map(({ value, text }) => ({ value, text })),
)

function onTabSelectChange(value: unknown) {
  if (value === 'general' || value === 'payments' || value === 'visits' || value === 'history') {
    activeTab.value = value
  }
}

const visitsPages = computed(() => {
  const limit = props.visitsLimit ?? 10
  const total = props.visitsTotal ?? 0
  return Math.max(1, Math.ceil(total / limit))
})

const visitsPageModel = computed({
  get: () => props.visitsPage ?? 1,
  set: (value: number) => emit('update:visitsPage', value),
})

const visitsLimitModel = computed({
  get: () => props.visitsLimit ?? 10,
  set: (value: number) => emit('update:visitsLimit', value),
})

const visitsHasActiveDateFilters = computed(
  () => Boolean(props.visitsFrom?.trim()) || Boolean(props.visitsTo?.trim()),
)

const PAYMENT_STATUS_OPTIONS = ['PENDING', 'PAID', 'REFUNDED'] as const
const PAYMENT_STATUS_ALL = '__ALL__'
const PAYMENT_CHANNEL_ALL = '__ALL__'
const CONTRACT_STATUS_OPTIONS = ['ACTIVE', 'SAVED', 'PAUSED', 'EXPIRED', 'CANCELLED'] as const
const CONTRACT_STATUS_ALL = '__ALL__'

const paymentsPage = ref(1)
const paymentsLimit = ref<number>(DEFAULT_TABLE_PAGE_LIMIT)
const paymentsSortBy = ref<'paidAt' | 'amount' | 'status' | 'contractNumber' | 'channel'>('paidAt')
const paymentsSortOrder = ref<'asc' | 'desc'>('desc')
const paymentsFilters = reactive({
  status: '' as '' | (typeof PAYMENT_STATUS_OPTIONS)[number],
  channel: '' as '' | 'CASH' | 'NON_CASH',
  from: '',
  to: '',
})

const contractsPage = ref(1)
const contractsLimit = ref<number>(DEFAULT_TABLE_PAGE_LIMIT)
const contractsSortBy = ref<
  | 'contractNumber'
  | 'status'
  | 'contractDate'
  | 'serviceStartDate'
  | 'serviceEndDate'
  | 'balanceDue'
  | 'servicePrice'
>('contractDate')
const contractsSortOrder = ref<'asc' | 'desc'>('desc')
const contractsFilters = reactive({
  status: '' as '' | (typeof CONTRACT_STATUS_OPTIONS)[number],
  from: '',
  to: '',
  contractSearch: '',
})

const paymentsStatusFilterOptions = computed(() => [
  { value: PAYMENT_STATUS_ALL, text: t('common.all') },
  ...PAYMENT_STATUS_OPTIONS.map((s) => ({
    value: s,
    text: paymentHistoryStatusLabel(s),
  })),
])

const paymentsChannelFilterOptions = computed(() => [
  { value: PAYMENT_CHANNEL_ALL, text: t('common.all') },
  { value: 'CASH', text: t('clients.paymentChannelCash') },
  { value: 'NON_CASH', text: t('clients.paymentChannelNonCash') },
])

const contractsStatusFilterOptions = computed(() => [
  { value: CONTRACT_STATUS_ALL, text: t('common.all') },
  ...CONTRACT_STATUS_OPTIONS.map((s) => ({
    value: s,
    text: t(`contracts.contractStatuses.${s}`),
  })),
])

const paymentsHasActiveFilters = computed(
  () =>
    Boolean(paymentsFilters.status) ||
    Boolean(paymentsFilters.channel) ||
    Boolean(paymentsFilters.from.trim()) ||
    Boolean(paymentsFilters.to.trim()),
)

const contractsHasActiveFilters = computed(
  () =>
    Boolean(contractsFilters.status) ||
    Boolean(contractsFilters.from.trim()) ||
    Boolean(contractsFilters.to.trim()) ||
    Boolean(contractsFilters.contractSearch.trim()),
)

const paymentsDateRangeModel = computed(() => {
  const from = paymentsFilters.from.trim()
  const to = paymentsFilters.to.trim()
  if (!from && !to) return undefined
  return {
    start: from ? parseVisitDateIso(from) ?? undefined : undefined,
    end: to ? parseVisitDateIso(to) ?? undefined : undefined,
  }
})

const contractsDateRangeModel = computed(() => {
  const from = contractsFilters.from.trim()
  const to = contractsFilters.to.trim()
  if (!from && !to) return undefined
  return {
    start: from ? parseVisitDateIso(from) ?? undefined : undefined,
    end: to ? parseVisitDateIso(to) ?? undefined : undefined,
  }
})

const paymentsHistoryTableColumns = computed(() => [
  { key: 'paidAt', label: t('clients.paymentPaidAt'), sortable: true },
  { key: 'amount', label: t('payments.columnAmount'), sortable: true },
  { key: 'status', label: t('clients.statusLabel'), sortable: true },
  { key: 'contractNumber', label: t('clients.contractHistoryNumberColumn'), sortable: true },
  { key: 'channel', label: t('payments.columnChannel'), sortable: true },
])

const contractsHistoryTableColumns = computed(() => [
  { key: 'contractNumber', label: t('clients.contractHistoryNumberColumn'), sortable: true },
  { key: 'status', label: t('clients.statusLabel'), sortable: true },
  { key: 'contractDate', label: t('clients.contractHistoryContractDateColumn'), sortable: true },
  { key: 'serviceStartDate', label: t('clients.contractHistoryStartColumn'), sortable: true },
  { key: 'serviceEndDate', label: t('clients.contractHistoryEndColumn'), sortable: true },
  { key: 'balanceDue', label: t('clients.contractBalanceColumn'), sortable: true },
  { key: 'actions', label: t('clients.actions'), sortable: false },
])

function normalizePaymentStatus(status?: string): string {
  const s = (status || '').trim().toUpperCase()
  return s === 'REFUND' ? 'REFUNDED' : s
}

function matchesClientTabDateFilter(isoValue: string, from: string, to: string): boolean {
  const tms = new Date(isoValue).getTime()
  if (!Number.isFinite(tms)) return false
  const fromIso = from.trim().slice(0, 10)
  const toIso = to.trim().slice(0, 10)
  if (fromIso && /^\d{4}-\d{2}-\d{2}$/.test(fromIso)) {
    const f = new Date(`${fromIso}T00:00:00.000Z`).getTime()
    if (tms < f) return false
  }
  if (toIso && /^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    const te = new Date(`${toIso}T23:59:59.999Z`).getTime()
    if (tms > te) return false
  }
  return true
}

const filteredPaymentsHistory = computed(() => {
  const list = props.paymentsHistory ?? []
  const qStatus = paymentsFilters.status
  const qChannel = paymentsFilters.channel
  return list.filter((item) => {
    if (qStatus && normalizePaymentStatus(item.status) !== qStatus) return false
    if (qChannel && (item.channel || 'CASH').toUpperCase() !== qChannel) return false
    if (!matchesClientTabDateFilter(item.paidAt, paymentsFilters.from, paymentsFilters.to)) return false
    return true
  })
})

const filteredContractsHistory = computed(() => {
  const list = props.contractHistory ?? []
  const qStatus = contractsFilters.status
  const qSearch = contractsFilters.contractSearch.trim().toLowerCase()
  return list.filter((item) => {
    if (qStatus && (item.status || '') !== qStatus) return false
    if (qSearch && !(item.contractNumber || '').toLowerCase().includes(qSearch)) return false
    if (!matchesClientTabDateFilter(item.contractDate ?? item.createdAt, contractsFilters.from, contractsFilters.to)) return false
    return true
  })
})

function sortClientTabRows<T extends { id: string }>(
  list: T[],
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  valueOf: (row: T, key: string) => string | number,
): T[] {
  const factor = sortOrder === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const av = valueOf(a, sortBy)
    const bv = valueOf(b, sortBy)
    if (typeof av === 'number' && typeof bv === 'number') {
      const d = av - bv
      if (d !== 0) return d * factor
      return String(a.id).localeCompare(String(b.id)) * factor
    }
    const c = String(av ?? '').localeCompare(String(bv ?? ''), locale.value === 'en' ? 'en' : 'ru')
    if (c !== 0) return c * factor
    return String(a.id).localeCompare(String(b.id)) * factor
  })
}

const sortedPaymentsHistory = computed(() =>
  sortClientTabRows(filteredPaymentsHistory.value, paymentsSortBy.value, paymentsSortOrder.value, (row, key) => {
    if (key === 'amount') return Number(row.amount)
    if (key === 'paidAt') {
      const tms = new Date(row.paidAt).getTime()
      return Number.isFinite(tms) ? tms : 0
    }
    if (key === 'contractNumber') return row.contract?.contractNumber?.trim() || ''
    if (key === 'channel') return (row.channel || 'CASH').toUpperCase()
    if (key === 'status') return normalizePaymentStatus(row.status)
    return ''
  }),
)

const sortedContractsHistory = computed(() =>
  sortClientTabRows(filteredContractsHistory.value, contractsSortBy.value, contractsSortOrder.value, (row, key) => {
    if (key === 'servicePrice' || key === 'balanceDue') {
      const raw = key === 'balanceDue' ? row.balanceDue : row.servicePrice
      const n = Number(String(raw ?? '0').replace(',', '.'))
      return Number.isFinite(n) ? n : 0
    }
    if (key === 'serviceStartDate' || key === 'serviceEndDate' || key === 'contractDate') {
      const iso =
        key === 'contractDate'
          ? row.contractDate
          : row[key]
      const tms = iso ? new Date(iso).getTime() : 0
      return Number.isFinite(tms) ? tms : 0
    }
    if (key === 'contractNumber') return row.contractNumber || ''
    if (key === 'status') return row.status || ''
    return ''
  }),
)

const paymentsPages = computed(() =>
  Math.max(1, Math.ceil(sortedPaymentsHistory.value.length / paymentsLimit.value)),
)
const contractsPages = computed(() =>
  Math.max(1, Math.ceil(sortedContractsHistory.value.length / contractsLimit.value)),
)

const pagedPaymentsHistory = computed(() => {
  const start = (paymentsPage.value - 1) * paymentsLimit.value
  return sortedPaymentsHistory.value.slice(start, start + paymentsLimit.value)
})

const pagedContractsHistory = computed(() => {
  const start = (contractsPage.value - 1) * contractsLimit.value
  return sortedContractsHistory.value.slice(start, start + contractsLimit.value)
})

function onPaymentsDateRangeChange(value: unknown) {
  if (value == null || value === '' || value === false) {
    paymentsFilters.from = ''
    paymentsFilters.to = ''
    paymentsPage.value = 1
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    paymentsFilters.from = a != null && a !== '' ? visitToIsoDate(a) : ''
    paymentsFilters.to = b != null && b !== '' ? visitToIsoDate(b) : ''
    paymentsPage.value = 1
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    paymentsFilters.from = r.start != null && r.start !== '' ? visitToIsoDate(r.start) : ''
    paymentsFilters.to = r.end != null && r.end !== '' ? visitToIsoDate(r.end) : ''
    paymentsPage.value = 1
  }
}

function onContractsDateRangeChange(value: unknown) {
  if (value == null || value === '' || value === false) {
    contractsFilters.from = ''
    contractsFilters.to = ''
    contractsPage.value = 1
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    contractsFilters.from = a != null && a !== '' ? visitToIsoDate(a) : ''
    contractsFilters.to = b != null && b !== '' ? visitToIsoDate(b) : ''
    contractsPage.value = 1
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    contractsFilters.from = r.start != null && r.start !== '' ? visitToIsoDate(r.start) : ''
    contractsFilters.to = r.end != null && r.end !== '' ? visitToIsoDate(r.end) : ''
    contractsPage.value = 1
  }
}

function resetPaymentsTabFilters() {
  paymentsFilters.status = ''
  paymentsFilters.channel = ''
  paymentsFilters.from = ''
  paymentsFilters.to = ''
  paymentsPage.value = 1
}

function resetContractsTabFilters() {
  contractsFilters.status = ''
  contractsFilters.from = ''
  contractsFilters.to = ''
  contractsFilters.contractSearch = ''
  contractsPage.value = 1
}

function onPaymentsSortByUpdate(next?: string) {
  if (!next) return
  if (paymentsSortBy.value === next) {
    paymentsSortOrder.value = paymentsSortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  paymentsSortBy.value = next as typeof paymentsSortBy.value
  paymentsSortOrder.value = next === 'paidAt' ? 'desc' : 'asc'
}

function onPaymentsSortOrderUpdate(next?: string) {
  paymentsSortOrder.value = next === 'desc' ? 'desc' : 'asc'
}

function onContractsSortByUpdate(next?: string) {
  if (!next) return
  if (contractsSortBy.value === next) {
    contractsSortOrder.value = contractsSortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  contractsSortBy.value = next as typeof contractsSortBy.value
  contractsSortOrder.value =
    next === 'contractDate' || next === 'serviceStartDate' || next === 'serviceEndDate' ? 'desc' : 'asc'
}

function onContractsSortOrderUpdate(next?: string) {
  contractsSortOrder.value = next === 'desc' ? 'desc' : 'asc'
}

function resetClientTabTablesState() {
  paymentsPage.value = 1
  paymentsLimit.value = DEFAULT_TABLE_PAGE_LIMIT
  paymentsSortBy.value = 'paidAt'
  paymentsSortOrder.value = 'desc'
  paymentsFilters.status = ''
  paymentsFilters.channel = ''
  paymentsFilters.from = ''
  paymentsFilters.to = ''
  contractsPage.value = 1
  contractsLimit.value = DEFAULT_TABLE_PAGE_LIMIT
  contractsSortBy.value = 'contractDate'
  contractsSortOrder.value = 'desc'
  contractsFilters.status = ''
  contractsFilters.from = ''
  contractsFilters.to = ''
  contractsFilters.contractSearch = ''
}

watch(
  () => props.photoUploadClientId,
  () => {
    resetClientTabTablesState()
  },
)

watch([paymentsPages, paymentsLimit], () => {
  if (paymentsPage.value > paymentsPages.value) paymentsPage.value = paymentsPages.value
})

watch([contractsPages, contractsLimit], () => {
  if (contractsPage.value > contractsPages.value) contractsPage.value = contractsPages.value
})

watch(
  () => [paymentsFilters.status, paymentsFilters.channel, paymentsFilters.from, paymentsFilters.to],
  () => {
    paymentsPage.value = 1
  },
)

watch(
  () => [contractsFilters.status, contractsFilters.from, contractsFilters.to, contractsFilters.contractSearch],
  () => {
    contractsPage.value = 1
  },
)

function parseVisitDateIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [yy, mm, dd] = value.split('-').map((v) => Number(v))
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

const visitsDateRangeModel = computed(() => {
  const from = props.visitsFrom?.trim() ?? ''
  const to = props.visitsTo?.trim() ?? ''
  if (!from && !to) return undefined
  return {
    start: from ? parseVisitDateIso(from) ?? undefined : undefined,
    end: to ? parseVisitDateIso(to) ?? undefined : undefined,
  }
})

function visitToIsoDate(value: unknown): string {
  return pickerValueToIsoYmd(value)
}

function onVisitsDateRangeChange(value: unknown) {
  if (value == null || value === '' || value === false) {
    emit('update:visitsFrom', '')
    emit('update:visitsTo', '')
    return
  }
  if (Array.isArray(value)) {
    const [a, b] = value
    emit('update:visitsFrom', a != null && a !== '' ? visitToIsoDate(a) : '')
    emit('update:visitsTo', b != null && b !== '' ? visitToIsoDate(b) : '')
    return
  }
  if (typeof value === 'object' && value !== null && ('start' in value || 'end' in value)) {
    const r = value as { start?: Date | string | null; end?: Date | string | null }
    emit('update:visitsFrom', r.start != null && r.start !== '' ? visitToIsoDate(r.start) : '')
    emit('update:visitsTo', r.end != null && r.end !== '' ? visitToIsoDate(r.end) : '')
  }
}

function formatVisitDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale.value === 'en' ? 'en-US' : 'ru-RU')
}

function visitStateLabel(state: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED') {
  if (state === 'IN_GYM') return t('visits.stateInGym')
  if (state === 'OVERDUE') return t('visits.stateOverdue')
  if (state === 'FORCE_CLOSED') return t('visits.stateForceClosed')
  return t('visits.stateLeft')
}

function visitStateTone(state: 'IN_GYM' | 'LEFT' | 'OVERDUE' | 'FORCE_CLOSED'): 'success' | 'neutral' | 'warning' | 'danger' {
  if (state === 'IN_GYM') return 'success'
  if (state === 'OVERDUE') return 'warning'
  if (state === 'FORCE_CLOSED') return 'danger'
  return 'neutral'
}

function visitCloseReasonLabel(reason?: string | null) {
  if (!reason) return '—'
  return t(`visits.closeReason.${reason}`)
}

function visitCloseReasonTone(reason?: string | null): 'success' | 'neutral' | 'warning' | 'danger' {
  if (!reason || reason === 'NORMAL') return 'neutral'
  if (reason === 'FOUND_LATER') return 'warning'
  if (reason === 'AUTO_TIMEOUT') return 'warning'
  if (reason === 'LOST_KEY' || reason === 'BLOCKED') return 'danger'
  if (reason === 'ADMIN_CORRECTION') return 'warning'
  return 'neutral'
}

function visitActorName(row?: { firstName?: string | null; lastName?: string | null; login?: string } | null) {
  if (!row) return '—'
  const full = [row.lastName, row.firstName].filter(Boolean).join(' ').trim()
  return full || row.login || '—'
}

const visitsHistoryTableColumns = computed(() => [
  { key: 'lockerNumber', label: t('visits.locker'), sortable: false },
  { key: 'status', label: t('clients.statusLabel'), sortable: false },
  { key: 'enteredAt', label: t('visits.enteredAt'), sortable: false },
  { key: 'exitedAt', label: t('visits.exitedAt'), sortable: false },
  { key: 'closeReason', label: t('visits.closeReasonLabel'), sortable: false },
  { key: 'exitedBy', label: t('clients.visitClosedBy'), sortable: false },
])

function pickPrimaryListContract<
  T extends { id: string; status?: string; createdAt: string },
>(contracts: T[]): T | null {
  const activePool = contracts.filter((c) => c.status === 'ACTIVE')
  const pool = activePool.length > 0 ? activePool : contracts.filter((c) => c.status === 'PAUSED')
  if (pool.length === 0) return null
  return pool.reduce((best, c) => {
    const ct = new Date(c.createdAt).getTime()
    const bt = new Date(best.createdAt).getTime()
    return ct > bt || (ct === bt && c.id > best.id) ? c : best
  })
}

function formatContractHistoryUiDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tag = locale.value === 'en' ? 'en-US' : 'ru-RU'
  return d.toLocaleDateString(tag)
}

function contractHistoryDateCell(iso: string | null | undefined): string {
  return formatContractHistoryUiDate(iso ?? undefined) || '—'
}

function contractHistoryStatusLabel(status?: string | null): string {
  const key = status || 'ACTIVE'
  return t(`contracts.contractStatusesShort.${key}`)
}

function contractHistoryStatusTitle(status?: string | null): string {
  const key = status || 'ACTIVE'
  return t(`contracts.contractStatuses.${key}`)
}

type ContractHistoryRow = NonNullable<(typeof props)['contractHistory']>[number]

const contractHistoryRowMenuOpenId = ref<string | null>(null)
const contractHistoryRowMenuRow = ref<ContractHistoryRow | null>(null)
const contractHistoryRowMenuAnchorRect = ref<DOMRect | null>(null)

function closeContractHistoryRowMenu() {
  contractHistoryRowMenuOpenId.value = null
  contractHistoryRowMenuRow.value = null
  contractHistoryRowMenuAnchorRect.value = null
}

const contractHistoryRowMenuLayerStyle = computed(() => {
  const r = contractHistoryRowMenuAnchorRect.value
  if (!r || typeof window === 'undefined') return {}
  const gap = 6
  const reserve = 10
  const winW = window.innerWidth
  const winH = window.innerHeight
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
    return { ...base, bottom: `${winH - r.top + gap}px`, top: 'auto' }
  }
  return { ...base, top: `${r.bottom + gap}px`, bottom: 'auto' }
})

function onContractHistoryRowMenuTriggerClick(row: ContractHistoryRow, ev: MouseEvent) {
  const el = ev.currentTarget
  if (!(el instanceof HTMLElement)) return
  if (contractHistoryRowMenuOpenId.value === row.id) {
    closeContractHistoryRowMenu()
    return
  }
  contractHistoryRowMenuOpenId.value = row.id
  contractHistoryRowMenuRow.value = row
  contractHistoryRowMenuAnchorRect.value = el.getBoundingClientRect()
}

function runContractHistoryRowMenuAction(
  row: ContractHistoryRow | null,
  action: (r: ContractHistoryRow) => void,
) {
  if (!row) return
  closeContractHistoryRowMenu()
  action(row)
}

function contractHistoryPauseNote(row: ContractHistoryRow): string {
  if (row.status !== 'PAUSED' || !row.pauseUntil) return ''
  if (
    typeof row.pauseDurationDays === 'number' &&
    Number.isFinite(row.pauseDurationDays) &&
    row.pauseDurationDays > 0
  ) {
    return t('clients.pauseUntilWithDays', {
      date: formatRuDate(row.pauseUntil),
      days: row.pauseDurationDays,
    })
  }
  return t('clients.pauseUntilLabel', { date: formatRuDate(row.pauseUntil) })
}

/** Запуск очередного — только после окончания текущего; ACTIVE и PAUSED блокируют. */
function hasBlockingMembershipForActivate(excludeId: string): boolean {
  return (props.contractHistory ?? []).some(
    (c) => c.id !== excludeId && (c.status === 'ACTIVE' || c.status === 'PAUSED'),
  )
}

function canActivateQueuedContract(item: { id: string; status?: string }): boolean {
  return item.status === 'SAVED' && !hasBlockingMembershipForActivate(item.id)
}

function activateQueuedContractTooltip(item: { id: string; status?: string }): string {
  if (item.status !== 'SAVED') return ''
  return canActivateQueuedContract(item)
    ? t('clients.activateContract')
    : t('contracts.activateBlockedActiveExists')
}

const currentContract = computed(() => pickPrimaryListContract(props.contractHistory ?? []))
const hasCurrentContract = computed(() => Boolean(currentContract.value))
const canEditContractData = computed(() => false)

/** Активный договор в API; на карточке клиента `contractNumber` может быть пустым, пока не подтянулась история. */
const displayContractNumber = computed(() => {
  const fromDoc = currentContract.value?.contractNumber?.trim()
  if (fromDoc) return fromDoc
  return props.modelValue.contractNumber.trim()
})

const contractSummarySignedDate = computed(() =>
  contractHistoryDateCell(
    currentContract.value?.contractDate ?? props.modelValue.paymentDate ?? null,
  ),
)

const contractSummaryStartDate = computed(() =>
  contractHistoryDateCell(
    currentContract.value?.serviceStartDate ?? props.modelValue.contractStartDate ?? null,
  ),
)

const contractSummaryEndDate = computed(() =>
  contractHistoryDateCell(
    currentContract.value?.serviceEndDate ?? props.modelValue.contractEndDate ?? null,
  ),
)

const currentContractBalanceDue = computed(() => {
  const item = currentContract.value
  if (!item || !contractShowsUnderpaidNote(item)) return ''
  const bal = Number(String(item.balanceDue ?? '0').replace(',', '.'))
  return Number.isFinite(bal) ? bal.toFixed(2) : ''
})

async function copyToClipboard(text: string) {
  const v = text.trim()
  if (!v) return
  const copied = await copyTextToClipboard(v)
  if (copied) {
    notify({ color: 'success', message: t('common.copied'), duration: 2200 })
  } else {
    notify({ color: 'danger', message: t('common.copyFailed'), duration: 3200 })
  }
}

const cardNumberRequiredError = computed(
  () => props.attempted && !props.modelValue.cardNumber.trim(),
)

function formatRuDate(dateLike?: string | null) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU')
}

function clearPhoto() {
  photoUploadError.value = null
  avatarLoadFailed.value = false
  resetPendingPhotoFile()
  patch('photoUrl', '')
}

function requestClearPhoto() {
  photoRemoveConfirmOpen.value = true
}

function confirmClearPhoto() {
  photoRemoveConfirmOpen.value = false
  clearPhoto()
}

function openPhotoViewer() {
  if (!showPhotoPreviewImg.value) return
  photoViewerOpen.value = true
}

const cardScannerOpen = ref(false)
const cardScannerDraft = ref('')
const cardScannerModalBodyRef = ref<HTMLElement | null>(null)

function openCardScannerModal() {
  cardScannerDraft.value = props.modelValue.cardNumber
  cardScannerOpen.value = true
}

function focusCardScannerInput() {
  const root = cardScannerModalBodyRef.value
  if (!root) return
  const input = root.querySelector('input') as HTMLInputElement | null
  input?.focus()
  input?.select()
}

watch(cardScannerOpen, async (open) => {
  if (!open) return
  await nextTick()
  focusCardScannerInput()
})

function confirmCardScanner() {
  patch('cardNumber', cardScannerDraft.value.trim())
  markTouched('cardNumber')
  cardScannerOpen.value = false
}

function cancelCardScanner() {
  cardScannerOpen.value = false
}

const birthPickerMonthNames = buildMonthNames('ru-RU')
const birthPickerWeekdayNames = buildWeekdayNames('ru-RU')

function onBirthTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  birthTextValue.value = normalized
  dateErrors.value.birthDate = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (birthMask && birthMask.value !== normalized) {
    birthMask.value = normalized
  }
}

function onContractStartTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  contractStartTextValue.value = normalized
  dateErrors.value.contractStartDate = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (contractStartTextMask && contractStartTextMask.value !== normalized) {
    contractStartTextMask.value = normalized
  }
}

function onContractEndTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  contractEndTextValue.value = normalized
  dateErrors.value.contractEndDate = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (contractEndTextMask && contractEndTextMask.value !== normalized) {
    contractEndTextMask.value = normalized
  }
}

function onPaymentTextInput(value: string) {
  const normalized = value.replace(/[^\d.]/g, '').slice(0, 10)
  paymentTextValue.value = normalized
  dateErrors.value.paymentDate = normalized.length > 0 && !ruDateTextToIso(normalized)
  if (paymentTextMask && paymentTextMask.value !== normalized) {
    paymentTextMask.value = normalized
  }
}

function onBirthTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(birthTextValue.value)
  birthTextValue.value = text
  if (birthMask && birthMask.value !== text) birthMask.value = text
  dateErrors.value.birthDate = !valid
  patch('birthDate', valid ? iso : '')
}

function onContractStartTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(contractStartTextValue.value)
  contractStartTextValue.value = text
  if (contractStartTextMask && contractStartTextMask.value !== text) contractStartTextMask.value = text
  dateErrors.value.contractStartDate = !valid
  patch('contractStartDate', valid ? iso : '')
}

function onContractEndTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(contractEndTextValue.value)
  contractEndTextValue.value = text
  if (contractEndTextMask && contractEndTextMask.value !== text) contractEndTextMask.value = text
  dateErrors.value.contractEndDate = !valid
  patch('contractEndDate', valid ? iso : '')
}

function onPaymentTextBlur() {
  const { text, iso, valid } = normalizeDateInputText(paymentTextValue.value)
  paymentTextValue.value = text
  if (paymentTextMask && paymentTextMask.value !== text) paymentTextMask.value = text
  dateErrors.value.paymentDate = !valid
  patch('paymentDate', valid ? iso : '')
}


function mountPhoneMask() {
  if (phoneMask || !phoneFieldRef.value) return
  const root =
    '$el' in phoneFieldRef.value
      ? (phoneFieldRef.value.$el as HTMLElement)
      : (phoneFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  phoneMask = IMask(input, {
    mask: '+{7} (000) 000-00-00',
    lazy: true,
  })
  phoneMask.on('accept', () => {
    if (!phoneMask) return
    // keep empty when user clears all editable digits
    const normalized = phoneMask.unmaskedValue.length <= 1 ? '' : phoneMask.value
    if (normalized !== props.modelValue.phone) patch('phone', normalized)
  })
  const initial = props.modelValue.phone || ''
  phoneMask.value = initial
}

function mountPassportMask() {
  if (passportMask || !passportFieldRef.value) return
  const root =
    '$el' in passportFieldRef.value
      ? (passportFieldRef.value.$el as HTMLElement)
      : (passportFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  passportMask = IMask(input, {
    mask: '0000 000000',
    lazy: true,
  })
  passportMask.on('accept', () => {
    if (!passportMask) return
    const normalized = passportMask.unmaskedValue.length === 0 ? '' : passportMask.value
    if (normalized !== props.modelValue.passport) patch('passport', normalized)
  })
  passportMask.value = props.modelValue.passport || ''
}

function mountBirthMask() {
  if (birthMask || !birthTextFieldRef.value) return
  const root =
    '$el' in birthTextFieldRef.value
      ? (birthTextFieldRef.value.$el as HTMLElement)
      : (birthTextFieldRef.value as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return
  birthMask = IMask(input, {
    mask: '00.00.0000',
    lazy: true,
    overwrite: true,
  })
  birthMask.on('accept', () => {
    if (!birthMask) return
    birthTextValue.value = birthMask.value
    dateErrors.value.birthDate = hasDateFormatError(birthMask.value)
    const digits = birthMask.unmaskedValue
    if (digits.length === 0) {
      if (props.modelValue.birthDate) patch('birthDate', '')
      return
    }
    if (digits.length < 8) return
    const iso = ruDateTextToIso(birthMask.value)
    if (iso && iso !== props.modelValue.birthDate) patch('birthDate', iso)
  })
  const initialBirthText = toRuDateText(props.modelValue.birthDate)
  birthTextValue.value = initialBirthText
  birthMask.value = initialBirthText
}

function createMaskedDateInput(
  fieldRef: ComponentPublicInstance | HTMLElement | null,
  getModelValue: () => string,
  setModelValue: (nextIso: string) => void,
  onText: (text: string) => void,
  errorKey: 'contractStartDate' | 'contractEndDate' | 'paymentDate',
) {
  if (!fieldRef) return null
  const root = '$el' in fieldRef ? (fieldRef.$el as HTMLElement) : (fieldRef as HTMLElement)
  const input = root.querySelector('input') as HTMLInputElement | null
  if (!input) return null
  const mask = IMask(input, {
    mask: '00.00.0000',
    lazy: true,
    overwrite: true,
  })
  mask.on('accept', () => {
    onText(mask.value)
    dateErrors.value[errorKey] = hasDateFormatError(mask.value)
    const digits = mask.unmaskedValue
    if (digits.length === 0) {
      if (getModelValue()) setModelValue('')
      return
    }
    if (digits.length < 8) return
    const iso = ruDateTextToIso(mask.value)
    if (iso && iso !== getModelValue()) setModelValue(iso)
  })
  const initialText = toRuDateText(getModelValue())
  onText(initialText)
  mask.value = initialText
  return mask
}

function mountContractStartMask() {
  if (contractStartTextMask || !contractStartTextFieldRef.value) return
  contractStartTextMask = createMaskedDateInput(
    contractStartTextFieldRef.value,
    () => props.modelValue.contractStartDate,
    (next) => patch('contractStartDate', next),
    (text) => (contractStartTextValue.value = text),
    'contractStartDate',
  )
}

function mountContractEndMask() {
  if (contractEndTextMask || !contractEndTextFieldRef.value) return
  contractEndTextMask = createMaskedDateInput(
    contractEndTextFieldRef.value,
    () => props.modelValue.contractEndDate,
    (next) => patch('contractEndDate', next),
    (text) => (contractEndTextValue.value = text),
    'contractEndDate',
  )
}

function mountPaymentMask() {
  if (paymentTextMask || !paymentTextFieldRef.value) return
  paymentTextMask = createMaskedDateInput(
    paymentTextFieldRef.value,
    () => props.modelValue.paymentDate,
    (next) => patch('paymentDate', next),
    (text) => (paymentTextValue.value = text),
    'paymentDate',
  )
}

function onBirthDatePickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    patch('birthDate', '')
    return
  }
  patch('birthDate', formatIsoDate(value))
  dateErrors.value.birthDate = false
  birthPickerOpen.value = false
}

function onContractStartPickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    patch('contractStartDate', '')
    return
  }
  patch('contractStartDate', formatIsoDate(value))
  dateErrors.value.contractStartDate = false
  contractStartPickerOpen.value = false
}

function onContractEndPickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    patch('contractEndDate', '')
    return
  }
  patch('contractEndDate', formatIsoDate(value))
  dateErrors.value.contractEndDate = false
  contractEndPickerOpen.value = false
}

function onPaymentPickerSelect(value: unknown) {
  if (!(value instanceof Date)) {
    patch('paymentDate', '')
    return
  }
  patch('paymentDate', formatIsoDate(value))
  dateErrors.value.paymentDate = false
  paymentPickerOpen.value = false
}

function clearBirthDate() {
  birthTextValue.value = ''
  dateErrors.value.birthDate = false
  patch('birthDate', '')
  if (birthMask) birthMask.value = ''
}

function clearContractStartDate() {
  contractStartTextValue.value = ''
  dateErrors.value.contractStartDate = false
  patch('contractStartDate', '')
  if (contractStartTextMask) contractStartTextMask.value = ''
}

function clearContractEndDate() {
  contractEndTextValue.value = ''
  dateErrors.value.contractEndDate = false
  patch('contractEndDate', '')
  if (contractEndTextMask) contractEndTextMask.value = ''
}

function clearPaymentDate() {
  paymentTextValue.value = ''
  dateErrors.value.paymentDate = false
  patch('paymentDate', '')
  if (paymentTextMask) paymentTextMask.value = ''
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (birthPickerOpen.value && birthFieldWrapRef.value && !birthFieldWrapRef.value.contains(target)) {
    birthPickerOpen.value = false
  }
  if (
    contractStartPickerOpen.value &&
    contractStartFieldWrapRef.value &&
    !contractStartFieldWrapRef.value.contains(target)
  ) {
    contractStartPickerOpen.value = false
  }
  if (
    contractEndPickerOpen.value &&
    contractEndFieldWrapRef.value &&
    !contractEndFieldWrapRef.value.contains(target)
  ) {
    contractEndPickerOpen.value = false
  }
  if (paymentPickerOpen.value && paymentFieldWrapRef.value && !paymentFieldWrapRef.value.contains(target)) {
    paymentPickerOpen.value = false
  }
  const clicked = event.target
  if (!(clicked instanceof Element)) return
  if (clicked.closest('.contract-history-row-menu-layer')) return
  if (clicked.closest('.contract-history-row-menu__trigger')) return
  closeContractHistoryRowMenu()
}

function unmountPhoneMask() {
  if (!phoneMask) return
  phoneMask.destroy()
  phoneMask = null
}

function unmountPassportMask() {
  if (!passportMask) return
  passportMask.destroy()
  passportMask = null
}

function unmountBirthMask() {
  if (!birthMask) return
  birthMask.destroy()
  birthMask = null
}

function unmountContractDateMasks() {
  if (contractStartTextMask) {
    contractStartTextMask.destroy()
    contractStartTextMask = null
  }
  if (contractEndTextMask) {
    contractEndTextMask.destroy()
    contractEndTextMask = null
  }
  if (paymentTextMask) {
    paymentTextMask.destroy()
    paymentTextMask = null
  }
}

function markTouched(field: 'email' | 'cardNumber') {
  touched.value[field] = true
}

/** Неполный или неверный ввод даты (как при blur), чтобы по «Сохранить» подсветились и черновики. */
function dateSubmitInvalid(raw: string): boolean {
  const normalized = raw.replace(/[^\d.]/g, '').slice(0, 10)
  if (!normalized) return false
  return !normalizeDateInputText(raw).valid
}

/** Вызывается родителем после attempted=true: все поля с локальной валидацией показывают ошибки. */
function validateSubmitFields() {
  if (!props.attempted) return
  touched.value = { email: true, cardNumber: true }
  dateErrors.value.birthDate =
    dateSubmitInvalid(birthTextValue.value) || hasDateFormatError(birthTextValue.value)
  dateErrors.value.contractStartDate =
    dateSubmitInvalid(contractStartTextValue.value) || hasDateFormatError(contractStartTextValue.value)
  dateErrors.value.contractEndDate =
    dateSubmitInvalid(contractEndTextValue.value) || hasDateFormatError(contractEndTextValue.value)
  dateErrors.value.paymentDate =
    dateSubmitInvalid(paymentTextValue.value) || hasDateFormatError(paymentTextValue.value)
}

function focusFirstInvalid() {
  activeTab.value = 'general'
  const root = rootRef.value
  if (!root) return
  const steps: Array<{ invalid: boolean; selector: string }> = [
    { invalid: requiredError('lastName'), selector: '[data-client-field="lastName"] input' },
    { invalid: requiredError('firstName'), selector: '[data-client-field="firstName"] input' },
    { invalid: requiredError('phone'), selector: '[data-client-field="phone"] input' },
    {
      invalid:
        props.attempted &&
        (!props.modelValue.cardNumber.trim() ||
          cardNumberInvalid.value ||
          Boolean(props.cardNumberTaken)),
      selector: '.card-number-readonly input',
    },
    { invalid: Boolean(dateErrors.value.birthDate), selector: '[data-client-field="birthDate"] input' },
    { invalid: showEmailError.value, selector: '[data-client-field="email"] input' },
    { invalid: Boolean(dateErrors.value.contractStartDate), selector: '[data-client-field="contractStartDate"] input' },
    { invalid: Boolean(dateErrors.value.contractEndDate), selector: '[data-client-field="contractEndDate"] input' },
    { invalid: Boolean(dateErrors.value.paymentDate), selector: '[data-client-field="paymentDate"] input' },
  ]
  for (const { invalid, selector } of steps) {
    if (!invalid) continue
    const input = root.querySelector(selector) as HTMLInputElement | null
    if (input) {
      input.focus({ preventScroll: true })
      return
    }
  }
}

defineExpose({
  focusFirstInvalid,
  validateSubmitFields,
  flushPendingPhotoUpload,
  resetPhotoDraft,
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  if (addressSuggestTimer) clearTimeout(addressSuggestTimer)
  if (addressSuggestBlurTimer) clearTimeout(addressSuggestBlurTimer)
  if (tabSelectMq && tabSelectListener) tabSelectMq.removeEventListener('change', tabSelectListener)
  unmountPhoneMask()
  unmountBirthMask()
  unmountContractDateMasks()
  unmountPassportMask()
  stopCameraStream()
  resetPendingPhotoFile()
})

onMounted(async () => {
  tabSelectMq = window.matchMedia(MOBILE_TAB_SELECT_MQ)
  mobileTabSelect.value = tabSelectMq.matches
  tabSelectListener = (e: MediaQueryListEvent) => {
    mobileTabSelect.value = e.matches
  }
  tabSelectMq.addEventListener('change', tabSelectListener)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  await nextTick()
  birthTextValue.value = toRuDateText(props.modelValue.birthDate)
  contractStartTextValue.value = toRuDateText(props.modelValue.contractStartDate)
  contractEndTextValue.value = toRuDateText(props.modelValue.contractEndDate)
  paymentTextValue.value = toRuDateText(props.modelValue.paymentDate)
  mountPhoneMask()
  mountBirthMask()
  mountContractStartMask()
  mountContractEndMask()
  mountPaymentMask()
  mountPassportMask()
})

watch(activeTab, async (tab) => {
  closeContractHistoryRowMenu()
  await nextTick()
  if (tab === 'visits') {
    emit('visits-tab-open')
  }
  if (tab === 'general') {
    mountPhoneMask()
    mountBirthMask()
    mountContractStartMask()
    mountContractEndMask()
    mountPaymentMask()
    mountPassportMask()
    return
  }
  unmountPhoneMask()
  unmountBirthMask()
  unmountContractDateMasks()
  unmountPassportMask()
}, { immediate: true })

watch(
  () => props.isCreateMode,
  (isCreate) => {
    if (isCreate) activeTab.value = 'general'
  },
  { immediate: true },
)

watch(
  () => props.modelValue.phone,
  (value) => {
    if (!phoneMask) return
    const next = value || ''
    if (phoneMask.value !== next) phoneMask.value = next
  },
)

watch(
  () => props.modelValue.birthDate,
  (value) => {
    const next = toRuDateText(value || '')
    birthTextValue.value = next
    if (!birthMask) return
    if (birthMask.value !== next) birthMask.value = next
  },
)

watch(
  () => props.modelValue.passport,
  (value) => {
    if (!passportMask) return
    const next = value || ''
    if (passportMask.value !== next) passportMask.value = next
  },
)

watch(
  () => props.modelValue.contractStartDate,
  (value) => {
    const next = toRuDateText(value || '')
    contractStartTextValue.value = next
    if (!contractStartTextMask) return
    if (contractStartTextMask.value !== next) contractStartTextMask.value = next
  },
)

watch(
  () => props.modelValue.contractEndDate,
  (value) => {
    const next = toRuDateText(value || '')
    contractEndTextValue.value = next
    if (!contractEndTextMask) return
    if (contractEndTextMask.value !== next) contractEndTextMask.value = next
  },
)

watch(
  () => props.modelValue.paymentDate,
  (value) => {
    const next = toRuDateText(value || '')
    paymentTextValue.value = next
    if (!paymentTextMask) return
    if (paymentTextMask.value !== next) paymentTextMask.value = next
  },
)

watch(birthTextValue, (value) => {
  dateErrors.value.birthDate = hasDateFormatError(value)
})

watch(contractStartTextValue, (value) => {
  dateErrors.value.contractStartDate = hasDateFormatError(value)
})

watch(contractEndTextValue, (value) => {
  dateErrors.value.contractEndDate = hasDateFormatError(value)
})

watch(paymentTextValue, (value) => {
  dateErrors.value.paymentDate = hasDateFormatError(value)
})
</script>

<template>
  <div
    ref="rootRef"
    class="client-form-layout"
    :class="{ 'client-form-layout--tabbed': !isCreateMode }"
  >
    <div v-if="!isCreateMode && mobileTabSelect" class="tabs-select-wrap">
      <VaSelect
        :model-value="activeTab"
        :options="tabSelectOptions"
        value-by="value"
        text-by="text"
        class="tabs-select"
        :label="$t('clients.tabSectionSelect')"
        width="100%"
        @update:model-value="onTabSelectChange"
      />
    </div>
    <div
      v-else-if="!isCreateMode"
      class="client-form-tabs"
      role="tablist"
      :aria-label="$t('clients.tabListAria')"
    >
      <button
        v-for="tab in clientFormTabs"
        :key="tab.value"
        type="button"
        role="tab"
        class="client-form-tab"
        :class="{ 'client-form-tab--active': activeTab === tab.value }"
        :aria-selected="activeTab === tab.value ? 'true' : 'false'"
        @click="activeTab = tab.value"
      >
        <VaIcon :name="tab.icon" size="17px" class="client-form-tab__icon" aria-hidden="true" />
        <span class="client-form-tab__label">{{ tab.text }}</span>
      </button>
    </div>

    <div class="client-form-tab-body">
    <div v-if="activeTab === 'general'" class="general-layout">
      <h4 class="form-col__title">{{ $t('clients.sectionPersonal') }}</h4>
      <div class="general-top">
        <aside class="photo-rail" :class="{ 'photo-rail--busy': photoUploading }">
          <div
            class="photo-preview"
            :class="{ 'photo-preview--clickable': showPhotoPreviewImg }"
            role="presentation"
          >
            <img
              v-if="showPhotoPreviewImg"
              :src="photoPreviewSrc"
              alt=""
              @error="onPhotoPreviewImgError"
              @click="openPhotoViewer"
            />
            <div v-if="!showPhotoPreviewImg" class="photo-placeholder">
              {{
                avatarLoadFailed && modelValue.photoUrl?.trim()
                  ? $t('clients.photoLoadFailed')
                  : $t('clients.photoPlaceholder')
              }}
            </div>
          </div>
          <div class="photo-actions">
            <input
              ref="photoFileInputRef"
              type="file"
              class="photo-file-input-hidden"
              accept="image/jpeg,image/png,image/webp,image/gif"
              :disabled="photoUploading"
              @change="onPhotoSelected"
            />
            <VaButton
              type="button"
              preset="secondary"
              class="photo-action-half"
              :disabled="photoUploading"
              :aria-label="photoUploading ? $t('clients.photoUploading') : $t('clients.photoUpload')"
              :title="photoUploading ? $t('clients.photoUploading') : $t('clients.photoUpload')"
              @click="photoFileInputRef?.click()"
            >
              <VaIcon
                :name="photoUploading ? 'sync' : 'add_photo_alternate'"
                size="24px"
                class="photo-action-half__icon"
                :class="{ 'photo-action-half__icon--spin': photoUploading }"
              />
            </VaButton>
            <VaButton
              type="button"
              preset="secondary"
              class="photo-action-half"
              :disabled="photoUploading"
              :aria-label="$t('clients.photoTakePicture')"
              :title="$t('clients.photoTakePicture')"
              @click="photoCameraOpen = true"
            >
              <VaIcon name="photo_camera" size="24px" class="photo-action-half__icon" />
            </VaButton>
            <VaButton
              v-if="modelValue.photoUrl?.trim() || pendingPhotoFile"
              type="button"
              preset="secondary"
              color="danger"
              class="photo-action-half"
              :disabled="photoUploading"
              :aria-label="$t('clients.photoRemove')"
              :title="$t('clients.photoRemove')"
              @click="requestClearPhoto"
            >
              <VaIcon :name="TableActionIcon.delete" size="24px" class="photo-action-half__icon" />
            </VaButton>
          </div>
          <p v-if="pendingPhotoFile && !photoUploading" class="photo-draft-hint">{{ $t('clients.photoSaveToUpload') }}</p>
        </aside>
        <div class="control-grid">
          <VaInput
            data-client-field="lastName"
            :model-value="modelValue.lastName"
            :label="`${$t('clients.lastName')} *`"
            :immediate-validation="attempted"
            :error="requiredError('lastName')"
            :error-messages="requiredError('lastName') ? [$t('clients.requiredField')] : []"
            @update:model-value="patch('lastName', $event)"
          />
          <VaInput
            data-client-field="firstName"
            :model-value="modelValue.firstName"
            :label="`${$t('clients.firstName')} *`"
            :immediate-validation="attempted"
            :error="requiredError('firstName')"
            :error-messages="requiredError('firstName') ? [$t('clients.requiredField')] : []"
            @update:model-value="patch('firstName', $event)"
          />
          <VaInput
            :model-value="modelValue.middleName"
            :label="$t('clients.middleName')"
            @update:model-value="patch('middleName', $event)"
          />
          <VaInput
            ref="phoneFieldRef"
            data-client-field="phone"
            :model-value="modelValue.phone"
            :label="`${$t('clients.phone')} *`"
            :placeholder="$t('clients.phonePlaceholder')"
            :immediate-validation="attempted"
            :error="requiredError('phone')"
            :error-messages="requiredError('phone') ? [$t('clients.requiredField')] : []"
            @update:model-value="patch('phone', $event)"
          />
          <div ref="birthFieldWrapRef" class="custom-date-field">
            <VaInput
              ref="birthTextFieldRef"
              data-client-field="birthDate"
              :model-value="birthTextValue"
              :label="$t('clients.birthDate')"
              placeholder="дд.мм.гггг"
              inputmode="numeric"
              :immediate-validation="attempted"
              :class="{ 'date-input--invalid': dateErrors.birthDate }"
              :error="dateErrors.birthDate"
              :error-messages="dateErrors.birthDate ? ['Неверный формат даты'] : []"
              @focus="mountBirthMask()"
              @update:model-value="onBirthTextInput"
              @blur="onBirthTextBlur"
            >
              <template #appendInner>
                <VaButton
                  v-if="birthTextValue"
                  type="button"
                  preset="plain"
                  icon="close"
                  size="small"
                  class="date-clear-btn"
                  @click.stop="clearBirthDate"
                />
                <VaButton
                  type="button"
                  preset="plain"
                  icon="date_range"
                  size="medium"
                  class="date-trigger-btn"
                  @click.stop="birthPickerOpen = !birthPickerOpen"
                />
              </template>
            </VaInput>
            <div v-if="dateErrors.birthDate" class="date-error-text">Неверный формат даты</div>
            <div v-if="birthPickerOpen" class="date-picker-popup">
              <VaDatePicker
                :model-value="toDateValue(modelValue.birthDate)"
                :month-names="birthPickerMonthNames"
                :weekday-names="birthPickerWeekdayNames"
                first-weekday="monday"
                @update:model-value="onBirthDatePickerSelect"
              />
            </div>
          </div>
          <VaSelect
            :model-value="modelValue.gender || GENDER_UNSET_VALUE"
            :label="$t('clients.genderLabel')"
            :options="[
              { value: GENDER_UNSET_VALUE, text: $t('clients.genderEmpty') },
              { value: 'MALE', text: $t('clients.gender.MALE') },
              { value: 'FEMALE', text: $t('clients.gender.FEMALE') },
            ]"
            value-by="value"
            text-by="text"
            @update:model-value="patch('gender', $event === GENDER_UNSET_VALUE ? '' : $event)"
          />
        </div>
      </div>

      <div class="control-grid general-bottom">
        <VaInput
          :model-value="currentManagerName"
          :label="$t('clients.manager')"
          readonly
          disabled
        />
        <VaInput
          ref="passportFieldRef"
          :model-value="modelValue.passport"
          :label="$t('clients.passport')"
          @update:model-value="patch('passport', $event)"
        />
        <VaInput
          :model-value="modelValue.passportIssuedBy"
          :label="$t('clients.passportIssuedBy')"
          @update:model-value="patch('passportIssuedBy', $event)"
        />
        <VaDateInput
          :model-value="modelValue.passportIssuedAt || undefined"
          :label="$t('clients.passportIssuedAt')"
          clearable
          @update:model-value="patch('passportIssuedAt', visitToIsoDate($event))"
        />
        <VaInput
          class="card-number-readonly"
          readonly
          :model-value="modelValue.cardNumber"
          :label="`${$t('clients.cardNumber')} *`"
          :title="$t('clients.cardScannerFieldHint')"
          :immediate-validation="attempted"
          :error="cardNumberRequiredError || showCardNumberError"
          :error-messages="
            cardNumberRequiredError
              ? [$t('clients.requiredField')]
              : showCardNumberError
              ? [props.cardNumberTaken ? $t('clients.cardNumberTaken') : $t('clients.invalidCardNumber')]
              : []
          "
          @update:model-value="patch('cardNumber', $event)"
          @blur="markTouched('cardNumber')"
          @click="openCardScannerModal"
          @paste.prevent
        >
          <template #label>
            <span class="label-with-tip">
              <span>{{ $t('clients.cardNumber') }}</span>
              <VaPopover :message="$t('clients.cardNumberUniqueHint')">
                <VaIcon name="info_outline" size="14px" color="secondary" />
              </VaPopover>
            </span>
          </template>
          <template #appendInner>
            <div class="card-field-append">
              <VaButton
                type="button"
                preset="plain"
                icon="qr_code_scanner"
                size="small"
                class="field-copy-btn"
                :title="$t('clients.cardScannerButtonTitle')"
                @click.stop="openCardScannerModal"
              />
              <VaButton
                v-if="modelValue.cardNumber.trim()"
                type="button"
                preset="plain"
                icon="content_copy"
                size="small"
                class="field-copy-btn"
                :title="$t('common.copy')"
                @click.stop="copyToClipboard(modelValue.cardNumber)"
              />
            </div>
          </template>
        </VaInput>
        <VaInput
          data-client-field="email"
          :model-value="modelValue.email"
          :label="$t('clients.email')"
          type="email"
          :immediate-validation="attempted"
          :error="showEmailError"
          :error-messages="showEmailError ? [$t('clients.invalidEmail')] : []"
          @update:model-value="patch('email', $event)"
          @blur="markTouched('email')"
        />
        <div class="control-grid__full address-autocomplete">
          <VaInput
            :model-value="modelValue.address"
            :label="$t('clients.address')"
            @update:model-value="onAddressInput"
            @focus="onAddressFocus"
            @blur="onAddressBlur"
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
              @mousedown.prevent="selectAddressSuggestion(item)"
            >
              {{ item }}
            </button>
          </div>
        </div>
        <VaInput class="control-grid__full" :model-value="modelValue.notes" :label="$t('clients.notes')" @update:model-value="patch('notes', $event)" />

        <div v-if="!isCreateMode" class="contract-summary-panel control-grid__full">
          <header class="contract-summary-panel__header">
            <div class="contract-summary-panel__lead">
              <div class="contract-summary-panel__icon" aria-hidden="true">
                <VaIcon name="description" size="20px" />
              </div>
              <div class="contract-summary-panel__head-copy">
                <h3 class="contract-summary-panel__title">{{ $t('clients.sectionContract') }}</h3>
                <p v-if="hasCurrentContract && displayContractNumber" class="contract-summary-panel__number">
                  {{ displayContractNumber }}
                </p>
              </div>
            </div>
            <div v-if="hasCurrentContract" class="contract-summary-panel__meta">
              <span :title="contractHistoryStatusTitle(currentContract?.status)">
                <StatusBadge
                  :label="contractHistoryStatusLabel(currentContract?.status)"
                  :tone="contractStatusTone(currentContract?.status)"
                  class="contract-summary-panel__status"
                />
              </span>
              <span
                v-if="currentContract?.status === 'PAUSED' && currentContract?.pauseUntil"
                class="contract-summary-panel__pause"
              >
                <template
                  v-if="
                    typeof currentContract.pauseDurationDays === 'number' &&
                    Number.isFinite(currentContract.pauseDurationDays) &&
                    currentContract.pauseDurationDays > 0
                  "
                >
                  {{
                    $t('clients.pauseUntilWithDays', {
                      date: formatRuDate(currentContract.pauseUntil),
                      days: currentContract.pauseDurationDays,
                    })
                  }}
                </template>
                <template v-else>
                  {{ $t('clients.pauseUntilLabel', { date: formatRuDate(currentContract.pauseUntil) }) }}
                </template>
              </span>
              <button
                v-if="displayContractNumber"
                type="button"
                class="contract-summary-panel__copy"
                :title="$t('common.copy')"
                @click="copyToClipboard(displayContractNumber)"
              >
                <VaIcon name="content_copy" size="16px" />
              </button>
            </div>
          </header>

          <div v-if="!hasCurrentContract" class="contract-summary-panel__empty" role="status">
            <p class="contract-summary-panel__empty-title">{{ $t('clients.noActiveContractInCard') }}</p>
            <p class="contract-summary-panel__empty-desc">{{ $t('clients.noActiveContractHint') }}</p>
          </div>

          <div v-else class="contract-summary-panel__body">
            <div class="contract-summary-panel__grid">
              <div class="contract-summary-stat">
                <span class="contract-summary-stat__label">{{ $t('clients.contractHistoryContractDateColumn') }}</span>
                <span class="contract-summary-stat__value">{{ contractSummarySignedDate }}</span>
              </div>
              <div class="contract-summary-stat">
                <span class="contract-summary-stat__label">{{ $t('clients.contractHistoryStartColumn') }}</span>
                <span class="contract-summary-stat__value">{{ contractSummaryStartDate }}</span>
              </div>
              <div class="contract-summary-stat">
                <span class="contract-summary-stat__label">{{ $t('clients.contractHistoryEndColumn') }}</span>
                <span class="contract-summary-stat__value">{{ contractSummaryEndDate }}</span>
              </div>
              <div
                class="contract-summary-stat"
                :class="{ 'contract-summary-stat--balance': currentContractBalanceDue }"
              >
                <span class="contract-summary-stat__label">{{ $t('clients.contractBalanceColumn') }}</span>
                <span class="contract-summary-stat__value">{{
                  currentContractBalanceDue || '—'
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!isCreateMode && activeTab === 'payments'" class="history-tab payments-tab">
      <div v-if="contractsWithOutstandingBalance.length" class="add-contract-payment-panel">
        <header class="add-contract-payment-panel__header">
          <div class="add-contract-payment-panel__icon" aria-hidden="true">
            <VaIcon name="payments" size="20px" />
          </div>
          <h3 class="add-contract-payment-panel__title">{{ $t('clients.addContractPaymentTitle') }}</h3>
        </header>

        <div class="add-contract-payment-panel__fields">
          <VaSelect
            v-model="addPaymentContractId"
            :label="$t('clients.addContractPaymentContract')"
            :options="addPaymentContractOptions"
            text-by="text"
            value-by="value"
            class="add-contract-payment-panel__field add-contract-payment-panel__field--contract"
          />
          <VaInput
            v-model="addPaymentAmount"
            :label="$t('clients.addContractPaymentAmount')"
            inputmode="decimal"
            class="add-contract-payment-panel__field add-contract-payment-panel__field--amount"
          />
          <VaDateInput
            :model-value="addPaymentPaidAt || undefined"
            :label="$t('clients.addContractPaymentDate')"
            class="add-contract-payment-panel__field add-contract-payment-panel__field--date"
            @update:model-value="(v) => (addPaymentPaidAt = formatIsoDate(v))"
          />
        </div>

        <footer class="add-contract-payment-panel__footer">
          <div class="add-contract-payment-panel__channel">
            <span class="add-contract-payment-panel__channel-label">{{ $t('contracts.paymentChannel') }}</span>
            <div
              class="add-contract-payment-segment"
              role="group"
              :aria-label="$t('contracts.paymentChannel')"
            >
              <button
                type="button"
                class="add-contract-payment-segment__btn"
                :class="{ 'add-contract-payment-segment__btn--active': addPaymentChannel === 'CASH' }"
                @click="addPaymentChannel = 'CASH'"
              >
                {{ $t('contracts.paymentCash') }}
              </button>
              <button
                type="button"
                class="add-contract-payment-segment__btn"
                :class="{ 'add-contract-payment-segment__btn--active': addPaymentChannel === 'NON_CASH' }"
                @click="addPaymentChannel = 'NON_CASH'"
              >
                {{ $t('contracts.paymentNonCash') }}
              </button>
            </div>
          </div>
          <VaButton
            class="add-contract-payment-panel__submit"
            icon="check"
            :loading="addingContractPayment"
            @click="submitAddContractPayment"
          >
            {{ $t('clients.addContractPaymentSubmit') }}
          </VaButton>
        </footer>
      </div>
      <div class="client-tab-filters">
        <VaSelect
          :model-value="paymentsFilters.status === '' ? PAYMENT_STATUS_ALL : paymentsFilters.status"
          :label="$t('payments.filterStatus')"
          :options="paymentsStatusFilterOptions"
          text-by="text"
          value-by="value"
          class="client-tab-filters__select"
          @update:model-value="(v) => (paymentsFilters.status = v === PAYMENT_STATUS_ALL || v === '' ? '' : (v as typeof paymentsFilters.status))"
        />
        <VaSelect
          :model-value="paymentsFilters.channel === '' ? PAYMENT_CHANNEL_ALL : paymentsFilters.channel"
          :label="$t('payments.columnChannel')"
          :options="paymentsChannelFilterOptions"
          text-by="text"
          value-by="value"
          class="client-tab-filters__select"
          @update:model-value="(v) => (paymentsFilters.channel = v === PAYMENT_CHANNEL_ALL || v === '' ? '' : (v as typeof paymentsFilters.channel))"
        />
        <VaDateInput
          mode="range"
          :model-value="paymentsDateRangeModel"
          :label="$t('payments.filterDateRange')"
          :placeholder="$t('payments.filterDateRangePlaceholder')"
          clearable
          class="client-tab-filters__range"
          @update:model-value="onPaymentsDateRangeChange"
        />
        <VaButton
          size="small"
          preset="secondary"
          icon="close"
          :disabled="!paymentsHasActiveFilters"
          @click="resetPaymentsTabFilters"
        >
          {{ $t('contracts.resetFilters') }}
        </VaButton>
      </div>
      <div v-if="paymentsLoading" class="client-tab-state client-tab-state--loading" role="status" aria-live="polite">
        <VaIcon name="sync" size="32px" class="client-tab-state__spinner" aria-hidden="true" />
        <p class="client-tab-state__text">{{ $t('clients.paymentsLoading') }}</p>
      </div>
      <template v-else>
        <div v-if="!props.paymentsHistory?.length" class="client-tab-empty-wrap">
          <AppEmptyState
            icon="receipt_long"
            :title="$t('clients.paymentsEmptyTitle')"
            :description="$t('clients.paymentsEmptyDesc')"
          />
        </div>
        <template v-else>
          <div v-if="!filteredPaymentsHistory.length" class="client-tab-empty-wrap">
            <AppEmptyState
              icon="receipt_long"
              :title="$t('clients.paymentsEmptyTitle')"
              :description="$t('clients.paymentsEmptyDescFiltered')"
            />
          </div>
          <div v-else class="client-history-table-wrap">
            <VaDataTable
              :items="pagedPaymentsHistory"
              :columns="paymentsHistoryTableColumns"
              :sort-by="paymentsSortBy"
              :sorting-order="paymentsSortOrder"
              class="client-history-table client-history-table--payments"
              @update:sort-by="onPaymentsSortByUpdate"
              @update:sorting-order="onPaymentsSortOrderUpdate"
            >
              <template #cell(paidAt)="{ rowData }">
                {{ formatVisitDateTime(rowData.paidAt) }}
              </template>
              <template #cell(amount)="{ rowData }">
                <span class="client-history-table__amount">{{ Number(rowData.amount).toFixed(2) }}</span>
              </template>
              <template #cell(status)="{ rowData }">
                <StatusBadge
                  :label="paymentHistoryStatusLabel(rowData.status)"
                  :tone="paymentHistoryStatusTone(rowData.status)"
                />
              </template>
              <template #cell(contractNumber)="{ rowData }">
                {{
                  rowData.contract?.contractNumber?.trim()
                    ? rowData.contract.contractNumber.trim()
                    : '—'
                }}
              </template>
              <template #cell(channel)="{ rowData }">
                {{ paymentChannelLabel(rowData.channel) }}
              </template>
            </VaDataTable>
          </div>
          <div v-if="filteredPaymentsHistory.length > 0" class="client-tab-table-footer">
            <AppTablePagerRow
              v-model:page="paymentsPage"
              v-model:limit="paymentsLimit"
              :pages="paymentsPages"
              :disabled="paymentsLoading"
            />
          </div>
        </template>
      </template>
    </div>

    <div v-else-if="!isCreateMode && activeTab === 'visits'" class="history-tab visits-tab">
      <div class="visits-tab-filters">
        <VaDateInput
          mode="range"
          :model-value="visitsDateRangeModel"
          :label="$t('visits.filterDateRange')"
          :placeholder="$t('visits.dateRangePlaceholder')"
          clearable
          class="visits-tab-filters__range"
          @update:model-value="onVisitsDateRangeChange"
        />
        <VaButton
          size="small"
          preset="secondary"
          icon="close"
          :disabled="!visitsHasActiveDateFilters"
          @click="emit('visits-reset-filters')"
        >
          {{ $t('clients.visitsResetFilters') }}
        </VaButton>
      </div>
      <div v-if="visitsLoading" class="client-tab-state client-tab-state--loading" role="status" aria-live="polite">
        <VaIcon name="sync" size="32px" class="client-tab-state__spinner" aria-hidden="true" />
        <p class="client-tab-state__text">{{ $t('clients.visitsLoading') }}</p>
      </div>
      <template v-else>
        <div v-if="!props.visitsHistory?.length" class="client-tab-empty-wrap">
          <AppEmptyState
            icon="history"
            :title="$t('clients.visitsEmptyTitle')"
            :description="visitsHasActiveDateFilters ? $t('clients.visitsEmptyDescFiltered') : $t('clients.visitsEmptyDesc')"
          />
        </div>
        <div v-if="props.visitsHistory?.length" class="visits-history-table-wrap">
          <VaDataTable
            :items="props.visitsHistory"
            :columns="visitsHistoryTableColumns"
            class="visits-history-table"
          >
            <template #cell(lockerNumber)="{ rowData }">
              <span class="visits-history-table__locker">{{ rowData.lockerNumber || '—' }}</span>
            </template>
            <template #cell(status)="{ rowData }">
              <StatusBadge
                :label="visitStateLabel(rowData.status)"
                :tone="visitStateTone(rowData.status)"
              />
            </template>
            <template #cell(enteredAt)="{ rowData }">
              {{ formatVisitDateTime(rowData.enteredAt) }}
            </template>
            <template #cell(exitedAt)="{ rowData }">
              {{ formatVisitDateTime(rowData.exitedAt) }}
            </template>
            <template #cell(closeReason)="{ rowData }">
              <div class="visits-history-table__reason-cell">
                <StatusBadge
                  v-if="rowData.closeReason"
                  :label="visitCloseReasonLabel(rowData.closeReason)"
                  :tone="visitCloseReasonTone(rowData.closeReason)"
                />
                <span v-else>—</span>
                <span
                  v-if="rowData.comment?.trim()"
                  class="visits-history-table__comment"
                  :title="rowData.comment.trim()"
                >
                  {{ rowData.comment.trim() }}
                </span>
              </div>
            </template>
            <template #cell(exitedBy)="{ rowData }">
              {{ rowData.exitedAt ? visitActorName(rowData.exitedBy) : '—' }}
            </template>
          </VaDataTable>
        </div>
        <div v-if="(props.visitsTotal ?? 0) > 0" class="client-tab-table-footer">
          <AppTablePagerRow
            v-model:page="visitsPageModel"
            v-model:limit="visitsLimitModel"
            :pages="visitsPages"
            :disabled="visitsLoading"
          />
        </div>
      </template>
    </div>

    <div v-else-if="!isCreateMode && activeTab === 'history'" class="history-tab contracts-tab">
      <div class="client-tab-filters">
        <VaInput
          v-model="contractsFilters.contractSearch"
          :label="$t('payments.columnContract')"
          :placeholder="$t('clients.contractHistorySearchPlaceholder')"
          clearable
          class="client-tab-filters__search"
        />
        <VaSelect
          :model-value="contractsFilters.status === '' ? CONTRACT_STATUS_ALL : contractsFilters.status"
          :label="$t('clients.statusLabel')"
          :options="contractsStatusFilterOptions"
          text-by="text"
          value-by="value"
          class="client-tab-filters__select"
          @update:model-value="(v) => (contractsFilters.status = v === CONTRACT_STATUS_ALL || v === '' ? '' : (v as typeof contractsFilters.status))"
        />
        <VaDateInput
          mode="range"
          :model-value="contractsDateRangeModel"
          :label="$t('contracts.filterDateRange')"
          :placeholder="$t('payments.filterDateRangePlaceholder')"
          clearable
          class="client-tab-filters__range"
          @update:model-value="onContractsDateRangeChange"
        />
        <VaButton
          size="small"
          preset="secondary"
          icon="close"
          :disabled="!contractsHasActiveFilters"
          @click="resetContractsTabFilters"
        >
          {{ $t('contracts.resetFilters') }}
        </VaButton>
      </div>
      <div
        v-if="contractHistoryLoading"
        class="client-tab-state client-tab-state--loading"
        role="status"
        aria-live="polite"
      >
        <VaIcon name="sync" size="32px" class="client-tab-state__spinner" aria-hidden="true" />
        <p class="client-tab-state__text">{{ $t('clients.contractHistoryLoading') }}</p>
      </div>
      <template v-else>
        <div v-if="!props.contractHistory?.length" class="client-tab-empty-wrap">
          <AppEmptyState
            icon="folder_open"
            :title="$t('clients.contractHistoryEmptyTitle')"
            :description="$t('clients.contractHistoryEmptyDesc')"
          />
        </div>
        <template v-else>
          <div v-if="!filteredContractsHistory.length" class="client-tab-empty-wrap">
            <AppEmptyState
              icon="folder_open"
              :title="$t('clients.contractHistoryEmptyTitle')"
              :description="$t('clients.contractHistoryEmptyDescFiltered')"
            />
          </div>
          <div v-else class="client-history-table-wrap">
            <VaDataTable
              :items="pagedContractsHistory"
              :columns="contractsHistoryTableColumns"
              :sort-by="contractsSortBy"
              :sorting-order="contractsSortOrder"
              class="client-history-table client-history-table--contracts"
              @update:sort-by="onContractsSortByUpdate"
              @update:sorting-order="onContractsSortOrderUpdate"
            >
              <template #cell(contractNumber)="{ rowData }">
                <span
                  class="client-history-table__contract-number client-history-table__contract-number--compact"
                  :title="rowData.contractNumber || undefined"
                >
                  {{ rowData.contractNumber || '—' }}
                </span>
              </template>
              <template #cell(status)="{ rowData }">
                <span :title="contractHistoryStatusTitle(rowData.status)">
                  <StatusBadge
                    :label="contractHistoryStatusLabel(rowData.status)"
                    :tone="contractStatusTone(rowData.status)"
                    class="client-history-table__status-badge"
                  />
                </span>
              </template>
              <template #cell(contractDate)="{ rowData }">
                <span class="client-history-table__date">{{ contractHistoryDateCell(rowData.contractDate) }}</span>
              </template>
              <template #cell(serviceStartDate)="{ rowData }">
                <div
                  class="client-history-table__date-cell"
                  :title="contractHistoryPauseNote(rowData) || undefined"
                >
                  <span class="client-history-table__date">{{
                    contractHistoryDateCell(rowData.serviceStartDate)
                  }}</span>
                  <span v-if="contractHistoryPauseNote(rowData)" class="client-history-table__date-note">
                    {{ contractHistoryPauseNote(rowData) }}
                  </span>
                </div>
              </template>
              <template #cell(serviceEndDate)="{ rowData }">
                <span class="client-history-table__date">{{ contractHistoryDateCell(rowData.serviceEndDate) }}</span>
              </template>
              <template #cell(balanceDue)="{ rowData }">
                <span
                  v-if="contractShowsUnderpaidNote(rowData)"
                  class="client-history-table__balance-due"
                >
                  {{
                    Number(String(rowData.balanceDue).replace(',', '.')).toFixed(2)
                  }}
                </span>
                <span v-else class="client-history-table__balance-ok">—</span>
              </template>
              <template #cell(actions)="{ rowData }">
                <div class="contract-history-row-menu">
                  <button
                    type="button"
                    class="contract-history-row-menu__trigger"
                    :aria-label="$t('contracts.actionsMenu')"
                    :aria-expanded="contractHistoryRowMenuOpenId === rowData.id ? 'true' : 'false'"
                    @click.stop="onContractHistoryRowMenuTriggerClick(rowData, $event)"
                  >
                    <VaIcon name="more_vert" size="22px" />
                  </button>
                </div>
              </template>
            </VaDataTable>
          </div>
          <div v-if="filteredContractsHistory.length > 0" class="client-tab-table-footer">
            <AppTablePagerRow
              v-model:page="contractsPage"
              v-model:limit="contractsLimit"
              :pages="contractsPages"
              :disabled="contractHistoryLoading"
            />
          </div>
        </template>
      </template>
    </div>
    </div>

    <div v-if="photoErrorBanner" class="client-form-footer-errors" role="alert">
      <div class="app-form-error-banner">{{ photoErrorBanner }}</div>
    </div>

    <VaModal v-model="cardScannerOpen" hide-default-actions fixed-layout max-width="min(92vw, 440px)">
      <div ref="cardScannerModalBodyRef" class="card-scanner-modal">
        <h3 class="card-scanner-modal__title">{{ $t('clients.cardScannerModalTitle') }}</h3>
        <p class="card-scanner-modal__hint">{{ $t('clients.cardScannerModalHint') }}</p>
        <VaInput
          v-model="cardScannerDraft"
          :label="$t('clients.cardNumber')"
          autocomplete="off"
          @keydown.enter.prevent="confirmCardScanner"
        />
        <div class="card-scanner-modal__actions">
          <VaButton type="button" preset="secondary" @click="cancelCardScanner">{{ $t('common.cancel') }}</VaButton>
          <VaButton type="button" @click="confirmCardScanner">{{ $t('users.save') }}</VaButton>
        </div>
      </div>
    </VaModal>

    <ConfirmModal
      v-model="photoRemoveConfirmOpen"
      :title="$t('clients.photoRemoveConfirmTitle')"
      :message="$t('clients.photoRemoveConfirmMessage')"
      :confirm-label="$t('clients.photoRemove')"
      :cancel-label="$t('common.cancel')"
      danger
      @confirm="confirmClearPhoto"
    />

    <VaModal v-model="photoViewerOpen" hide-default-actions fixed-layout max-width="min(96vw, 720px)">
      <div class="photo-viewer-modal">
        <h3 class="photo-viewer-modal__title">{{ $t('clients.photoViewTitle') }}</h3>
        <div class="photo-viewer-modal__frame">
          <img :src="photoPreviewSrc" alt="" class="photo-viewer-modal__img" />
        </div>
        <div class="photo-viewer-modal__actions">
          <VaButton preset="secondary" @click="photoViewerOpen = false">{{ $t('clients.photoViewClose') }}</VaButton>
        </div>
      </div>
    </VaModal>

    <VaModal v-model="photoCameraOpen" hide-default-actions fixed-layout max-width="min(92vw, 520px)">
      <div class="photo-camera-modal">
        <h3 class="photo-camera-modal__title">{{ $t('clients.photoCameraTitle') }}</h3>
        <p class="photo-camera-modal__hint">{{ $t('clients.photoCameraHint') }}</p>
        <div class="photo-camera-modal__video-wrap">
          <video
            ref="cameraVideoRef"
            class="photo-camera-modal__video"
            playsinline
            muted
            autoplay
          />
        </div>
        <div class="photo-camera-modal__actions">
          <VaButton type="button" preset="secondary" @click="cancelPhotoCamera">{{ $t('common.cancel') }}</VaButton>
          <VaButton type="button" :disabled="photoUploading" @click="confirmPhotoCameraCapture">{{
            $t('clients.photoCapture')
          }}</VaButton>
        </div>
      </div>
    </VaModal>

    <Teleport to="body">
      <div
        v-if="contractHistoryRowMenuRow"
        class="contract-history-row-menu-layer"
        :style="contractHistoryRowMenuLayerStyle"
        @click.stop
      >
        <div class="contract-history-row-menu__panel">
          <ul class="contract-history-row-menu__list" role="menu">
            <li v-if="contractHistoryRowMenuRow.status === 'SAVED'" role="none">
              <button
                type="button"
                role="menuitem"
                class="contract-history-row-menu__item"
                :disabled="!canActivateQueuedContract(contractHistoryRowMenuRow)"
                :title="activateQueuedContractTooltip(contractHistoryRowMenuRow)"
                @click="
                  runContractHistoryRowMenuAction(contractHistoryRowMenuRow, (r) =>
                    emit('activate-contract-history-item', r.id),
                  )
                "
              >
                <VaIcon :name="TableActionIcon.contractActivate" size="18px" />
                {{ $t('clients.activateContract') }}
              </button>
            </li>
            <li v-if="contractHistoryRowMenuRow.status === 'ACTIVE'" role="none">
              <button
                type="button"
                role="menuitem"
                class="contract-history-row-menu__item"
                @click="
                  runContractHistoryRowMenuAction(contractHistoryRowMenuRow, (r) =>
                    emit('pause-contract-history-item', r.id),
                  )
                "
              >
                <VaIcon :name="TableActionIcon.contractPause" size="18px" />
                {{ $t('contracts.pause') }}
              </button>
            </li>
            <li v-if="contractHistoryRowMenuRow.status === 'PAUSED'" role="none">
              <button
                type="button"
                role="menuitem"
                class="contract-history-row-menu__item"
                @click="
                  runContractHistoryRowMenuAction(contractHistoryRowMenuRow, (r) =>
                    emit('resume-contract-history-item', r.id),
                  )
                "
              >
                <VaIcon :name="TableActionIcon.contractResume" size="18px" />
                {{ $t('contracts.resume') }}
              </button>
            </li>
            <li
              v-if="
                contractHistoryRowMenuRow.status !== 'CANCELLED' &&
                contractHistoryRowMenuRow.status !== 'EXPIRED'
              "
              role="none"
            >
              <button
                type="button"
                role="menuitem"
                class="contract-history-row-menu__item contract-history-row-menu__item--warning"
                @click="
                  runContractHistoryRowMenuAction(contractHistoryRowMenuRow, (r) =>
                    emit('terminate-contract-history-item', r.id),
                  )
                "
              >
                <VaIcon :name="TableActionIcon.contractTerminate" size="18px" />
                {{ $t('contracts.terminate') }}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="contract-history-row-menu__item"
                @click="
                  runContractHistoryRowMenuAction(contractHistoryRowMenuRow, (r) =>
                    emit('open-contract-history-item', r.id),
                  )
                "
              >
                <VaIcon :name="TableActionIcon.viewDocument" size="18px" />
                {{ $t('clients.openContract') }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.client-form-layout {
  display: grid;
  gap: 0.9rem;
}

.client-form-layout--tabbed {
  display: block;
}

.client-form-layout--tabbed .client-form-tabs {
  margin-bottom: 0.85rem;
}

.client-form-layout--tabbed .client-form-tab-body {
  overflow: visible;
  padding: 0;
}

.card-field-append {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}

.card-number-readonly :deep(.va-input-wrapper__text),
.card-number-readonly :deep(input) {
  cursor: pointer;
}

.card-scanner-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.25rem 0.15rem 0.5rem;
  box-sizing: border-box;
}

.card-scanner-modal__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.3;
}

.card-scanner-modal__hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--app-muted, #6b7280);
}

.card-scanner-modal__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.tabs-select-wrap {
  width: 100%;
  min-width: 0;
}

.tabs-select {
  width: 100%;
  --va-input-wrapper-width: 100%;
}

.client-form-tabs {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  flex-wrap: wrap;
  padding: 0.35rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  background: color-mix(in srgb, var(--app-text) 4%, var(--app-surface));
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--app-text) 5%, transparent);
}

.client-form-tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.42rem;
  min-height: 2.4rem;
  min-width: 0;
  padding: 0.45rem 0.75rem;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 56%, var(--app-muted));
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.client-form-tab:hover:not(.client-form-tab--active) {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-accent) 14%);
  border-color: color-mix(in srgb, var(--app-accent) 22%, transparent);
}

.client-form-tab--active {
  color: #fff;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 90%, white 10%) 0%,
    color-mix(in srgb, var(--app-accent) 76%, black 24%) 100%
  );
  border-color: color-mix(in srgb, var(--app-accent) 62%, black 38%);
  box-shadow:
    0 2px 10px color-mix(in srgb, var(--app-accent) 34%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
}

.client-form-tab__icon {
  flex-shrink: 0;
  opacity: 0.72;
}

.client-form-tab--active .client-form-tab__icon {
  opacity: 1;
}

.client-form-tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.client-form-tab__label {
  min-width: 0;
  white-space: nowrap;
}

.label-with-tip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.control-grid :deep(.va-select .va-input-wrapper__label) {
  pointer-events: auto;
}

.form-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem 1.05rem;
}

.general-layout {
  display: grid;
  gap: 0.72rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 85%, transparent);
  border-radius: 14px;
  padding: 0.8rem;
  background: color-mix(in srgb, var(--app-surface) 96%, white 4%);
}

.general-top {
  display: grid;
  grid-template-columns: 174px minmax(0, 1fr);
  gap: 0.9rem;
  align-items: start;
}

.general-bottom {
  margin-top: -0.08rem;
}

.form-col__title {
  margin: 0.05rem 0 0.25rem;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.045em;
  color: color-mix(in srgb, var(--app-muted) 78%, var(--app-text));
  font-weight: 700;
}

.form-col {
  display: grid;
  gap: 0.35rem;
  align-items: start;
}

.control-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.72rem 0.95rem;
  /* иначе сосед в строке растягивается по высоте из‑за блока сообщения об ошибке */
  align-items: start;
}

.control-grid > :deep(.va-input-wrapper),
.control-grid > :deep(.va-select),
.control-grid > :deep(.va-date-input) {
  min-width: 0;
  max-width: 100%;
}

.control-grid :deep(.va-input-wrapper__container),
.control-grid :deep(.va-input-wrapper__field),
.control-grid :deep(.va-select__anchor) {
  min-height: 2.85rem;
}

.control-grid :deep(.va-input-wrapper__messages) {
  min-height: 1.35rem;
  margin-top: 0.2rem;
}

.control-grid :deep(.va-message-list__list) {
  min-height: 1.35rem;
}

.control-grid :deep(.va-message-list__item) {
  line-height: 1.2;
}

/* Vuestic sets --va-input-wrapper-border-color to primary on .va-input-wrapper--focused after .va-input-wrapper--error */
.control-grid :deep(.va-input-wrapper--error.va-input-wrapper--focused) {
  --va-input-wrapper-border-color: var(--va-danger) !important;
}
.control-grid :deep(.va-input-wrapper--error .va-input-wrapper__field),
.control-grid :deep(.va-input-wrapper--error.va-input-wrapper--focused .va-input-wrapper__field) {
  border-color: var(--va-danger) !important;
  box-shadow: inset 0 0 0 1px var(--va-danger) !important;
}

.control-grid__full {
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.contract-summary-panel {
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-accent) 16%, var(--app-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-accent) 5%, var(--app-surface)) 0%,
    var(--app-surface) 48%
  );
  overflow: hidden;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-text) 6%, transparent);
}

.contract-summary-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
}

.contract-summary-panel__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  min-width: 0;
}

.contract-summary-panel__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent);
  flex-shrink: 0;
}

.contract-summary-panel__head-copy {
  min-width: 0;
}

.contract-summary-panel__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.3;
}

.contract-summary-panel__number {
  margin: 0.18rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--app-text) 72%, var(--app-muted));
  word-break: break-all;
}

.contract-summary-panel__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  flex-shrink: 0;
}

.contract-summary-panel__pause {
  font-size: 0.75rem;
  color: var(--app-muted);
  max-width: 14rem;
  text-align: right;
  line-height: 1.3;
}

.contract-summary-panel__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 8px;
  background: var(--app-surface);
  color: var(--app-muted);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.contract-summary-panel__copy:hover {
  color: var(--app-accent);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-accent) 14%);
}

.contract-summary-panel__copy:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.contract-summary-panel__empty {
  padding: 0.85rem 1rem 1rem;
}

.contract-summary-panel__empty-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.35;
}

.contract-summary-panel__empty-desc {
  margin: 0.35rem 0 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--app-muted) 55%, var(--app-text));
}

.contract-summary-panel__body {
  padding: 0.8rem 1rem 0.95rem;
}

.contract-summary-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
}

.contract-summary-stat {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: color-mix(in srgb, var(--app-surface) 94%, white 6%);
}

.contract-summary-stat__label {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.contract-summary-stat__value {
  font-size: 0.875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  color: var(--app-text);
}

.contract-summary-stat--balance .contract-summary-stat__value {
  color: var(--va-danger);
}

.contract-summary-panel :deep(.contract-summary-panel__status.status-badge) {
  padding: 0.12rem 0.45rem;
  min-height: 1.35rem;
  font-size: 0.68rem;
}

.client-tab-state--loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  min-height: 11rem;
  padding: 1.6rem 1rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: color-mix(in srgb, var(--app-surface) 96%, var(--app-accent) 5%);
}

.client-tab-state__spinner {
  animation: client-tab-spin 0.85s linear infinite;
  color: var(--app-accent-strong);
  opacity: 0.92;
}

.client-tab-state__text {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--app-text);
  text-align: center;
}

@keyframes client-tab-spin {
  to {
    transform: rotate(360deg);
  }
}

.client-tab-empty-wrap {
  margin-top: 0.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: min(36dvh, 18rem);
  padding: 0.75rem 0 1.25rem;
  box-sizing: border-box;
}

.client-tab-empty-wrap :deep(.empty-state) {
  width: 100%;
  box-sizing: border-box;
}

.control-grid--contract {
  gap: 0.65rem 0.9rem;
}

.control-grid--contract-readonly :deep(.va-input-wrapper__field),
.control-grid--contract-readonly :deep(.va-input-wrapper__text),
.control-grid--contract-readonly :deep(.va-input-wrapper__content) {
  opacity: 1;
  color: var(--app-text);
  font-weight: 400;
}

.control-grid--contract-readonly :deep(.va-input-wrapper--readonly) {
  opacity: 1;
}

.control-grid--contract-readonly :deep(.va-input-wrapper__messages),
.control-grid--contract-readonly :deep(.va-message-list__list) {
  min-height: 0;
  margin-top: 0;
}

.field-copy-btn {
  flex-shrink: 0;
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

.date-error-text {
  margin-top: 0.2rem;
  color: var(--va-danger);
  font-size: 0.78rem;
  line-height: 1.2;
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

.photo-block {
  display: contents;
}

.photo-rail {
  display: grid;
  align-content: start;
  gap: 0.45rem;
}

.photo-rail--busy {
  opacity: 0.85;
}

.client-form-footer-errors {
  margin-top: 0.35rem;
}

.photo-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklab, var(--app-surface) 94%, var(--app-muted) 6%);
}

.photo-preview img { width: 100%; height: 100%; object-fit: cover; }
.photo-preview--clickable img {
  cursor: zoom-in;
}
.photo-placeholder { font-size: 0.8rem; color: var(--app-muted); text-align: center; padding: 0 0.5rem; }

.photo-file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.photo-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0.45rem;
  width: 100%;
  position: relative;
}

.photo-actions :deep(.photo-action-half.va-button) {
  flex: 1 1 0;
  min-width: 0;
  min-height: 2.7rem;
  height: auto;
  border-radius: 10px;
}

.photo-actions :deep(.photo-action-half .va-button__content) {
  justify-content: center;
  align-items: center;
  padding: 0.4rem 0.35rem;
}

.photo-action-half__icon {
  color: color-mix(in srgb, var(--app-text) 78%, var(--app-muted));
}

.photo-action-half__icon--spin {
  animation: client-tab-spin 0.85s linear infinite;
}

.photo-camera-modal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.25rem 0.15rem 0.5rem;
  box-sizing: border-box;
}

.photo-camera-modal__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.3;
}

.photo-camera-modal__hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--app-muted, #6b7280);
}

.photo-camera-modal__video-wrap {
  border-radius: 10px;
  overflow: hidden;
  background: #0f0f12;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.photo-camera-modal__video {
  display: block;
  width: 100%;
  max-height: min(52vh, 420px);
  object-fit: contain;
}

.photo-camera-modal__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.photo-viewer-modal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.25rem 0.15rem 0.5rem;
}

.photo-viewer-modal__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.3;
}

.photo-viewer-modal__frame {
  border-radius: 12px;
  overflow: hidden;
  background: color-mix(in oklab, var(--app-surface) 92%, var(--app-muted) 8%);
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.photo-viewer-modal__img {
  display: block;
  width: 100%;
  max-height: min(72vh, 640px);
  object-fit: contain;
  margin: 0 auto;
}

.photo-viewer-modal__actions {
  display: flex;
  justify-content: flex-end;
}

.photo-draft-hint {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  line-height: 1.25;
  color: var(--app-muted);
  text-align: center;
  max-width: 9rem;
}

.history-tab {
  min-height: 10rem;
}

.contracts-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}

.contracts-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.contracts-actions--bottom {
  justify-content: flex-end;
}

.contract-history-list {
  display: grid;
  gap: 0.45rem;
}

.contract-history-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
}

.contract-history-row__main {
  flex: 1;
  min-width: 0;
}

.contract-history-header-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.65rem;
}

.contract-history-number {
  font-weight: 600;
  min-width: 0;
  line-height: 1.25;
}

.contract-history-date {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}

.contract-history-period {
  font-weight: 600;
}

.contract-history-registered {
  font-size: 0.85rem;
  opacity: 0.85;
}

.contract-history-status {
  margin-top: 0;
  font-size: 0.8rem;
  color: var(--app-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.contract-history-meta {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: var(--app-muted);
}

.contract-history-underpaid {
  margin-top: 0.45rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--va-warning) 50%, var(--app-border, #e5e7eb));
  background: color-mix(in srgb, var(--va-warning) 12%, var(--app-surface, #fff));
  color: var(--app-text, #111827);
  font-size: 0.82rem;
  line-height: 1.4;
}

.add-contract-payment-panel {
  margin-bottom: 1rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-accent) 16%, var(--app-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-accent) 5%, var(--app-surface)) 0%,
    var(--app-surface) 42%
  );
  overflow: hidden;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-text) 6%, transparent);
}

.add-contract-payment-panel__header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
}

.add-contract-payment-panel__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent);
  flex-shrink: 0;
}

.add-contract-payment-panel__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.3;
}

.add-contract-payment-panel__fields {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 0.75fr) minmax(0, 0.85fr);
  gap: 0.65rem 0.75rem;
  padding: 0.85rem 1rem 0.7rem;
}

.add-contract-payment-panel__field {
  min-width: 0;
}

.add-contract-payment-panel__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
  background: color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface));
}

.add-contract-payment-panel__channel {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.add-contract-payment-panel__channel-label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-muted);
}

.add-contract-payment-segment {
  display: inline-flex;
  min-height: 2.15rem;
  padding: 0.2rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
}

.add-contract-payment-segment__btn {
  min-width: 5.5rem;
  min-height: calc(2.15rem - 0.4rem);
  padding: 0.35rem 0.85rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 68%, var(--app-muted));
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.add-contract-payment-segment__btn:hover:not(.add-contract-payment-segment__btn--active) {
  background: color-mix(in srgb, var(--app-text) 5%, transparent);
  color: var(--app-text);
}

.add-contract-payment-segment__btn--active {
  color: #fff;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--app-accent) 88%, white 12%) 0%,
    color-mix(in srgb, var(--app-accent) 74%, black 26%) 100%
  );
  box-shadow: 0 1px 4px color-mix(in srgb, var(--app-accent) 28%, transparent);
}

.add-contract-payment-segment__btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.add-contract-payment-panel__submit {
  flex-shrink: 0;
  margin-left: auto;
  min-height: 2.35rem;
  padding-left: 1rem;
  padding-right: 1rem;
}

.payments-history-list .payments-history-row {
  align-items: stretch;
}

.payments-history-row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.payments-history-row__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.payments-history-row__amount {
  font-weight: 700;
  font-size: 0.95rem;
}

.payments-history-row__contract {
  font-size: 0.85rem;
  color: var(--app-text, inherit);
  line-height: 1.35;
}

.payments-history-row__date,
.payments-history-row__channel {
  font-size: 0.8rem;
  color: var(--app-muted);
}

.payments-history-row__comment {
  font-size: 0.8rem;
  color: var(--app-muted);
  line-height: 1.35;
}

.payments-history-row__badge {
  flex-shrink: 0;
}

.visits-tab-filters,
.client-tab-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: flex-end;
  margin-bottom: 0.85rem;
}

.visits-tab-filters__range,
.client-tab-filters__range {
  flex: 1 1 14rem;
  min-width: 12rem;
}

.client-tab-filters__select {
  flex: 0 1 10rem;
  min-width: 9rem;
}

.client-tab-filters__search {
  flex: 1 1 12rem;
  min-width: 10rem;
}

.visits-tab-pager,
.client-tab-pager {
  margin-top: 0.85rem;
}

.client-tab-table-footer {
  margin-top: 0.65rem;
  padding: 0.55rem 0.7rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface));
}

.client-history-table--payments {
  min-width: 0;
  width: 100%;
}

.client-history-table--payments :deep(.va-data-table__table) {
  table-layout: fixed;
  width: 100%;
}

.client-history-table--payments :deep(.va-data-table__table-th),
.client-history-table--payments :deep(.va-data-table__table-td) {
  padding: 0.28rem 0.35rem;
  font-size: 0.72rem;
  line-height: 1.25;
}

.client-history-table--payments :deep(.va-data-table__table-th) {
  font-size: 0.68rem;
}

.client-history-table--payments :deep(.va-data-table__table-th:nth-child(1)),
.client-history-table--payments :deep(.va-data-table__table-td:nth-child(1)) {
  width: 24%;
}

.client-history-table--payments :deep(.va-data-table__table-th:nth-child(2)),
.client-history-table--payments :deep(.va-data-table__table-td:nth-child(2)) {
  width: 12%;
}

.client-history-table--payments :deep(.va-data-table__table-th:nth-child(3)),
.client-history-table--payments :deep(.va-data-table__table-td:nth-child(3)) {
  width: 14%;
}

.client-history-table--payments :deep(.va-data-table__table-th:nth-child(4)),
.client-history-table--payments :deep(.va-data-table__table-td:nth-child(4)) {
  width: 28%;
}

.client-history-table--payments :deep(.va-data-table__table-th:nth-child(5)),
.client-history-table--payments :deep(.va-data-table__table-td:nth-child(5)) {
  width: 14%;
}

.client-history-table--payments :deep(.status-badge) {
  padding: 0.1rem 0.35rem;
  min-height: 1.2rem;
  font-size: 0.62rem;
  letter-spacing: 0;
}

.client-history-table-wrap:has(.client-history-table--payments) {
  overflow-x: hidden;
}

.visits-history-table-wrap,
.client-history-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--va-background-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--app-radius-sm, 0.5rem);
}

.visits-history-table,
.client-history-table {
  min-width: 42rem;
}

.client-history-table--contracts {
  min-width: 0;
  width: 100%;
}

.client-history-table--contracts :deep(.va-data-table__table) {
  table-layout: fixed;
  width: 100%;
}

.client-history-table--contracts :deep(.va-data-table__table-th),
.client-history-table--contracts :deep(.va-data-table__table-td) {
  padding: 0.25rem 0.3rem;
  font-size: 0.72rem;
  line-height: 1.25;
}

.client-history-table--contracts :deep(.va-data-table__table-th) {
  font-size: 0.68rem;
  padding-top: 0.35rem;
  padding-bottom: 0.35rem;
}

.client-history-table--contracts :deep(.va-data-table__table-th:last-child),
.client-history-table--contracts :deep(.va-data-table__table-td:last-child) {
  width: 9%;
  min-width: 4.25rem;
  padding-left: 0.25rem;
  padding-right: 0.35rem;
  text-align: right;
}

.client-history-table--contracts :deep(.va-data-table__table-td:last-child) .contract-history-row-menu {
  width: 100%;
  justify-content: flex-end;
}

.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(1)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(1)) {
  width: 21%;
}

.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(2)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(2)) {
  width: 11%;
}

.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(3)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(3)),
.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(4)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(4)),
.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(5)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(5)) {
  width: 12%;
}

.client-history-table--contracts :deep(.va-data-table__table-th:nth-child(6)),
.client-history-table--contracts :deep(.va-data-table__table-td:nth-child(6)) {
  width: 8%;
}

.client-history-table-wrap:has(.client-history-table--contracts) {
  overflow-x: hidden;
}

.client-history-table__contract-number--compact {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  font-size: 0.72rem;
  font-weight: 600;
}

.client-history-table--contracts :deep(.client-history-table__status-badge) {
  padding: 0.1rem 0.35rem;
  min-height: 1.2rem;
  font-size: 0.62rem;
  letter-spacing: 0;
}

.client-history-table--contracts .client-history-table__date-cell {
  min-width: 0;
}

.client-history-table--contracts .client-history-table__date-note {
  display: none;
}

.client-history-table--contracts .contract-history-row-menu__trigger {
  width: 1.65rem;
  height: 1.65rem;
}

.client-history-table--contracts .contract-history-row-menu__trigger :deep(.va-icon) {
  font-size: 1.15rem !important;
}

.visits-history-table :deep(.va-data-table__table),
.client-history-table :deep(.va-data-table__table) {
  font-size: 0.8125rem;
}

.visits-history-table :deep(.va-data-table__table-th),
.client-history-table :deep(.va-data-table__table-th) {
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.45rem 0.55rem;
}

.visits-history-table :deep(.va-data-table__table-td),
.client-history-table :deep(.va-data-table__table-td) {
  vertical-align: middle;
  padding: 0.4rem 0.55rem;
  line-height: 1.3;
}

.client-history-table__amount,
.client-history-table__contract-number,
.visits-history-table__locker {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.client-history-table__date,
.client-history-table__date-cell {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.client-history-table__date-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 6.5rem;
}

.client-history-table__date-note {
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--app-muted);
}

.client-history-table__balance-due {
  color: var(--va-danger);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.client-history-table__balance-ok {
  color: var(--app-muted);
}

.contract-history-row-menu {
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
}

.contract-history-row-menu__trigger {
  cursor: pointer;
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
}

.contract-history-row-menu__trigger:hover {
  background: color-mix(in srgb, var(--app-surface) 86%, var(--va-primary) 14%);
}

.contract-history-row-menu-layer {
  box-sizing: border-box;
  min-width: 12.5rem;
}

.contract-history-row-menu-layer .contract-history-row-menu__panel {
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.contract-history-row-menu__list {
  margin: 0;
  padding: 0.3rem;
  min-width: 12.5rem;
  list-style: none;
}

.contract-history-row-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.55rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.contract-history-row-menu__item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--app-surface) 82%, var(--app-border) 18%);
}

.contract-history-row-menu__item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.contract-history-row-menu__item--warning {
  color: var(--va-warning);
}

.visits-history-table__reason-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  min-width: 0;
}

.visits-history-table__comment {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: var(--app-muted);
}

.contract-history-actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: nowrap;
  flex-shrink: 0;
  margin-left: auto;
  align-self: flex-start;
  justify-content: flex-end;
}

.contract-history-actions :deep(.va-button),
.contract-history-row > :deep(.va-button) {
  min-width: 2.2rem;
  min-height: 2.2rem;
  padding: 0;
}

/** Подсказка на disabled-кнопке: hover ловит обёртка, не сам button */
.contract-history-action-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.control-grid__date {
  width: 100%;
}

.control-grid :deep(.va-date-input .va-input-wrapper) {
  width: 100%;
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

.control-grid :deep(.va-date-input .va-icon) {
  font-size: 1.1rem;
}

.control-grid :deep(.va-date-picker__header) {
  padding: 0.55rem 0.7rem;
}

.control-grid :deep(.va-date-picker__month-year) {
  font-size: 0.93rem;
}

.control-grid :deep(.va-date-picker__weekday) {
  font-size: 0.67rem;
}

:deep(.va-date-picker) {
  min-width: 18rem;
}

@media (max-width: 820px) {
  .form-columns {
    grid-template-columns: 1fr;
  }
  .general-top {
    grid-template-columns: 1fr;
  }
  .control-grid {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .photo-rail {
    grid-template-columns: 120px 1fr;
    align-items: center;
    gap: 0.55rem;
  }
  .photo-preview {
    width: 120px;
  }
}

@media (max-width: 640px) {
  .client-form-tabs {
    flex-wrap: nowrap;
    gap: 0.3rem;
    padding: 0.32rem;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }

  .client-form-tab {
    flex: 0 0 auto;
    min-height: 2.1rem;
    padding: 0.4rem 0.62rem;
    font-size: 0.75rem;
    gap: 0.32rem;
  }

  .client-form-tab__icon {
    display: none;
  }

  .general-layout {
    padding: 0.42rem 0.38rem;
    border-radius: 12px;
    gap: 0.55rem;
  }

  .general-top {
    gap: 0.55rem;
  }

  .contract-summary-panel__header {
    flex-direction: column;
    align-items: stretch;
  }

  .contract-summary-panel__meta {
    justify-content: flex-start;
  }

  .contract-summary-panel__pause {
    max-width: none;
    text-align: left;
  }

  .contract-summary-panel__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .photo-rail {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    width: 100%;
    max-width: 8.75rem;
    margin-left: auto;
    margin-right: auto;
  }

  .photo-preview {
    width: 100%;
    max-width: 8rem;
  }

  .photo-actions {
    width: 100%;
    max-width: 8rem;
    justify-content: center;
    gap: 0.35rem;
  }

  .photo-actions :deep(.photo-action-half.va-button) {
    min-height: 2.35rem !important;
  }

  .form-col__title {
    font-size: 0.68rem;
    letter-spacing: 0.05em;
  }

  .contracts-form-grid {
    grid-template-columns: 1fr;
  }

  .contracts-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .contract-history-row {
    flex-direction: column;
    gap: 0.45rem;
  }

  .contract-history-actions {
    margin-left: 0;
    align-self: stretch;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .add-contract-payment-panel__fields {
    grid-template-columns: 1fr;
  }

  .add-contract-payment-panel__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .add-contract-payment-panel__submit {
    width: 100%;
    margin-left: 0;
  }

  .add-contract-payment-segment {
    width: 100%;
  }

  .add-contract-payment-segment__btn {
    flex: 1 1 0;
    min-width: 0;
  }

  .client-form-layout--tabbed .client-form-tab-body {
    padding: 0;
  }
}
</style>
