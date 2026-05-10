<script setup lang="ts">
import IMask, { type InputMask } from 'imask'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vuestic-ui'
import { TableActionIcon } from '@/config/tableActionIcons'
import type { ClientForm, ClientStatus } from '@/types/clients'
import StatusBadge from '@/components/ui/StatusBadge.vue'
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
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'

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
    pauseUntil?: string | null
    s3Url?: string | null
    createdAt: string
  }>
  contractHistoryLoading?: boolean
  paymentsHistory?: Array<{
    id: string
    amount: string | number
    paidAt: string
    status: string
    comment?: string | null
    contractDocumentId?: string | null
  }>
  paymentsLoading?: boolean
  /** Если задан — загрузка фото идёт в `clients/:id/…`; иначе в `clients/pending/…` (создание клиента). */
  photoUploadClientId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: ClientForm): void
  (e: 'generate-contract-number'): void
  (e: 'open-contract-history-item', id: string): void
  (e: 'pause-contract-history-item', id: string): void
  (e: 'resume-contract-history-item', id: string): void
  (e: 'terminate-contract-history-item', id: string): void
  /** После PATCH photoUrl в БД (редактирование клиента). */
  (e: 'photo-url-persisted'): void
}>()
const { t } = useI18n()
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

const MAX_PHOTO_MB = 8
const photoUploading = ref(false)
const photoUploadError = ref<string | null>(null)
/** Ссылка в БД есть, но <img> не смог загрузить (404/403/CORS к объекту и т.д.). */
const avatarLoadFailed = ref(false)

const safeAvatarSrc = computed(() => clientPhotoDisplayUrl(props.modelValue.photoUrl))

watch(
  () => props.modelValue.photoUrl,
  () => {
    avatarLoadFailed.value = false
  },
)

async function onPhotoSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return
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
    const publicUrl = data.publicUrl
    if (cid) {
      try {
        await api.patch(`/clients/${cid}`, { photoUrl: publicUrl })
      } catch (e: unknown) {
        photoUploadError.value = resolveApiErrorMessage(e, {
          defaultMessage: t('clients.photoSaveUrlFailed'),
          byCode: {
            PHOTO_DATA_URL_NOT_ALLOWED: t('clients.photoDataUrlNotAllowed'),
          },
        })
        return
      }
    }
    patch('photoUrl', publicUrl)
    if (cid) emit('photo-url-persisted')
    notify({ color: 'success', message: t('clients.photoUploadDone'), duration: 2000 })
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
  } finally {
    photoUploading.value = false
    if (input) input.value = ''
  }
}

const activeTab = ref<'general' | 'payments' | 'history'>('general')
const currentContract = computed(() =>
  (props.contractHistory ?? []).find((item) => item.status === 'ACTIVE' || item.status === 'PAUSED') ?? null,
)
const hasCurrentContract = computed(() => Boolean(currentContract.value))
const canEditContractData = computed(() => false)

/** Активный договор в API; на карточке клиента `contractNumber` может быть пустым, пока не подтянулась история. */
const displayContractNumber = computed(() => {
  const fromDoc = currentContract.value?.contractNumber?.trim()
  if (fromDoc) return fromDoc
  return props.modelValue.contractNumber.trim()
})

async function copyToClipboard(text: string) {
  const v = text.trim()
  if (!v) return
  try {
    await navigator.clipboard.writeText(v)
    notify({ color: 'success', message: t('common.copied'), duration: 2200 })
  } catch {
    notify({ color: 'danger', message: t('common.copyFailed'), duration: 3200 })
  }
}

const cardNumberRequiredError = computed(
  () => props.attempted && !props.modelValue.cardNumber.trim(),
)

const membershipLabelKey = computed(() =>
  hasCurrentContract.value ? 'clients.membership' : 'clients.plannedMembership',
)
const membershipHintKey = computed(() =>
  hasCurrentContract.value ? 'clients.membershipHintActive' : 'clients.plannedMembershipHint',
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
  patch('photoUrl', '')
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

defineExpose({ focusFirstInvalid, validateSubmitFields })

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  if (addressSuggestTimer) clearTimeout(addressSuggestTimer)
  if (addressSuggestBlurTimer) clearTimeout(addressSuggestBlurTimer)
  unmountPhoneMask()
  unmountBirthMask()
  unmountContractDateMasks()
  unmountPassportMask()
})

onMounted(async () => {
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
  await nextTick()
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
})

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
  <div ref="rootRef" class="client-form-layout">
    <div v-if="!isCreateMode" class="tabs-row" role="tablist" aria-label="Client form tabs">
      <VaButton type="button" size="small" :preset="activeTab === 'general' ? 'primary' : 'secondary'" @click="activeTab = 'general'">
        {{ $t('clients.tabGeneral') }}
      </VaButton>
      <VaButton type="button" size="small" :preset="activeTab === 'payments' ? 'primary' : 'secondary'" @click="activeTab = 'payments'">
        {{ $t('clients.tabPayments') }}
      </VaButton>
      <VaButton type="button" size="small" :preset="activeTab === 'history' ? 'primary' : 'secondary'" @click="activeTab = 'history'">
        {{ $t('clients.tabHistory') }}
      </VaButton>
    </div>

    <div v-if="activeTab === 'general'" class="general-layout">
      <h4 class="form-col__title">{{ $t('clients.sectionPersonal') }}</h4>
      <div class="general-top">
        <aside class="photo-rail" :class="{ 'photo-rail--busy': photoUploading }">
          <VaAlert v-if="photoUploadError" color="danger" outline class="photo-upload-alert">{{
            photoUploadError
          }}</VaAlert>
          <div
            class="photo-preview"
            :class="{ 'photo-preview--deletable': Boolean(modelValue.photoUrl?.trim()) }"
          >
            <img
              v-if="safeAvatarSrc && !avatarLoadFailed"
              :src="safeAvatarSrc"
              alt=""
              @error="avatarLoadFailed = true"
            />
            <div v-if="!safeAvatarSrc || avatarLoadFailed" class="photo-placeholder">
              {{
                avatarLoadFailed && modelValue.photoUrl?.trim()
                  ? $t('clients.photoLoadFailed')
                  : $t('clients.photoPlaceholder')
              }}
            </div>
            <button
              v-if="modelValue.photoUrl?.trim()"
              type="button"
              class="photo-preview__delete"
              :disabled="photoUploading"
              :title="$t('clients.photoRemove')"
              :aria-label="$t('clients.photoRemove')"
              @click="clearPhoto"
            >
              <VaIcon :name="TableActionIcon.delete" size="28px" />
            </button>
          </div>
          <label class="photo-upload">
            <span>{{ photoUploading ? $t('clients.photoUploading') : $t('clients.photoUpload') }}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" :disabled="photoUploading" @change="onPhotoSelected" />
          </label>
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
        <VaSelect
          :model-value="modelValue.status"
          :label="$t('clients.statusLabel')"
          :options="statusOptions"
          value-by="value"
          text-by="text"
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
        <VaInput
          :model-value="currentManagerName"
          :label="$t('clients.manager')"
          readonly
          disabled
        />
        <VaSelect
          :model-value="modelValue.membershipType"
          :label="$t(membershipLabelKey)"
          :options="membershipOptions"
          value-by="value"
          text-by="text"
          :readonly="!isCreateMode && hasCurrentContract"
          :disabled="!isCreateMode && hasCurrentContract"
          @update:model-value="patch('membershipType', $event)"
        >
          <template #label>
            <span class="label-with-tip">
              <span>{{ $t(membershipLabelKey) }}</span>
              <VaPopover :message="$t(membershipHintKey)">
                <VaIcon name="info_outline" size="14px" color="secondary" />
              </VaPopover>
            </span>
          </template>
        </VaSelect>
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

        <div v-if="!isCreateMode" class="contract-panel control-grid__full">
          <div class="contract-panel__title">{{ $t('clients.sectionContract') }}</div>
          <div v-if="hasCurrentContract" class="contract-panel__status">
            <StatusBadge
              :label="$t(`contracts.contractStatuses.${currentContract?.status || 'ACTIVE'}`)"
              :tone="contractStatusTone(currentContract?.status)"
            />
            <span
              v-if="currentContract?.status === 'PAUSED' && currentContract?.pauseUntil"
              class="contract-panel__pause"
            >
              {{ $t('clients.pauseUntilLabel', { date: formatRuDate(currentContract.pauseUntil) }) }}
            </span>
          </div>
          <div v-else class="contract-empty-state">
            <VaIcon name="description" size="18px" color="secondary" />
            <span>{{ $t('clients.noActiveContractInCard') }}</span>
          </div>
          <div v-if="hasCurrentContract" class="control-grid control-grid--contract control-grid--contract-readonly">
            <VaInput
              :model-value="displayContractNumber"
              :label="$t('clients.contractNumber')"
              readonly
            >
              <template #appendInner>
                <VaButton
                  v-if="canEditContractData"
                  type="button"
                  preset="plain"
                  icon="autorenew"
                  size="small"
                  @click.stop="emit('generate-contract-number')"
                />
                <VaButton
                  v-if="displayContractNumber"
                  type="button"
                  preset="plain"
                  icon="content_copy"
                  size="small"
                  class="field-copy-btn"
                  :title="$t('common.copy')"
                  @click.stop="copyToClipboard(displayContractNumber)"
                />
              </template>
            </VaInput>
            <div ref="contractStartFieldWrapRef" class="custom-date-field">
              <VaInput
                ref="contractStartTextFieldRef"
                data-client-field="contractStartDate"
                :model-value="contractStartTextValue"
                :label="$t('clients.contractStartDate')"
                placeholder="дд.мм.гггг"
                inputmode="numeric"
                readonly
                :immediate-validation="attempted"
                :class="{ 'date-input--invalid': dateErrors.contractStartDate }"
                :error="dateErrors.contractStartDate"
                :error-messages="dateErrors.contractStartDate ? ['Неверный формат даты'] : []"
                @focus="mountContractStartMask()"
              >
                <template #appendInner>
                  <VaButton
                    v-if="canEditContractData && contractStartTextValue"
                    type="button"
                    preset="plain"
                    icon="close"
                    size="small"
                    class="date-clear-btn"
                    @click.stop="clearContractStartDate"
                  />
                  <VaButton
                    v-if="canEditContractData"
                    type="button"
                    preset="plain"
                    icon="date_range"
                    size="medium"
                    class="date-trigger-btn"
                    @click.stop="contractStartPickerOpen = !contractStartPickerOpen"
                  />
                </template>
              </VaInput>
              <div v-if="dateErrors.contractStartDate" class="date-error-text">Неверный формат даты</div>
              <div v-if="canEditContractData && contractStartPickerOpen" class="date-picker-popup">
                <VaDatePicker
                  :model-value="toDateValue(modelValue.contractStartDate)"
                  :month-names="birthPickerMonthNames"
                  :weekday-names="birthPickerWeekdayNames"
                  first-weekday="monday"
                  @update:model-value="onContractStartPickerSelect"
                />
              </div>
            </div>
            <div ref="contractEndFieldWrapRef" class="custom-date-field">
              <VaInput
                ref="contractEndTextFieldRef"
                data-client-field="contractEndDate"
                :model-value="contractEndTextValue"
                :label="$t('clients.contractEndDate')"
                placeholder="дд.мм.гггг"
                inputmode="numeric"
                readonly
                :immediate-validation="attempted"
                :class="{ 'date-input--invalid': dateErrors.contractEndDate }"
                :error="dateErrors.contractEndDate"
                :error-messages="dateErrors.contractEndDate ? ['Неверный формат даты'] : []"
                @focus="mountContractEndMask()"
              >
                <template #appendInner>
                  <VaButton
                    v-if="canEditContractData && contractEndTextValue"
                    type="button"
                    preset="plain"
                    icon="close"
                    size="small"
                    class="date-clear-btn"
                    @click.stop="clearContractEndDate"
                  />
                  <VaButton
                    v-if="canEditContractData"
                    type="button"
                    preset="plain"
                    icon="date_range"
                    size="medium"
                    class="date-trigger-btn"
                    @click.stop="contractEndPickerOpen = !contractEndPickerOpen"
                  />
                </template>
              </VaInput>
              <div v-if="dateErrors.contractEndDate" class="date-error-text">Неверный формат даты</div>
              <div v-if="canEditContractData && contractEndPickerOpen" class="date-picker-popup">
                <VaDatePicker
                  :model-value="toDateValue(modelValue.contractEndDate)"
                  :month-names="birthPickerMonthNames"
                  :weekday-names="birthPickerWeekdayNames"
                  first-weekday="monday"
                  @update:model-value="onContractEndPickerSelect"
                />
              </div>
            </div>
            <div ref="paymentFieldWrapRef" class="custom-date-field">
              <VaInput
                ref="paymentTextFieldRef"
                data-client-field="paymentDate"
                :model-value="paymentTextValue"
                :label="$t('clients.paymentDate')"
                placeholder="дд.мм.гггг"
                inputmode="numeric"
                readonly
                :immediate-validation="attempted"
                :class="{ 'date-input--invalid': dateErrors.paymentDate }"
                :error="dateErrors.paymentDate"
                :error-messages="dateErrors.paymentDate ? ['Неверный формат даты'] : []"
                @focus="mountPaymentMask()"
              >
                <template #appendInner>
                  <VaButton
                    v-if="canEditContractData && paymentTextValue"
                    type="button"
                    preset="plain"
                    icon="close"
                    size="small"
                    class="date-clear-btn"
                    @click.stop="clearPaymentDate"
                  />
                  <VaButton
                    v-if="canEditContractData"
                    type="button"
                    preset="plain"
                    icon="date_range"
                    size="medium"
                    class="date-trigger-btn"
                    @click.stop="paymentPickerOpen = !paymentPickerOpen"
                  />
                </template>
              </VaInput>
              <div v-if="dateErrors.paymentDate" class="date-error-text">Неверный формат даты</div>
              <div v-if="canEditContractData && paymentPickerOpen" class="date-picker-popup">
                <VaDatePicker
                  :model-value="toDateValue(modelValue.paymentDate)"
                  :month-names="birthPickerMonthNames"
                  :weekday-names="birthPickerWeekdayNames"
                  first-weekday="monday"
                  @update:model-value="onPaymentPickerSelect"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!isCreateMode && activeTab === 'payments'" class="history-tab">
      <VaAlert v-if="paymentsLoading" color="info" outline>
        {{ $t('clients.paymentsLoading') }}
      </VaAlert>
      <VaAlert v-else-if="!props.paymentsHistory?.length" color="secondary" outline>
        {{ $t('clients.paymentsPlaceholder') }}
      </VaAlert>
      <div v-else class="contract-history-list">
        <div v-for="item in props.paymentsHistory" :key="item.id" class="contract-history-row">
          <div>
            <div class="contract-history-number">
              {{ $t('clients.paymentAmount', { amount: Number(item.amount).toFixed(2) }) }}
            </div>
            <div class="contract-history-date">
              {{ new Date(item.paidAt).toLocaleString('ru-RU') }} · {{ item.status }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!isCreateMode" class="history-tab">
      <VaAlert v-if="contractHistoryLoading" color="info" outline>
        {{ $t('clients.contractHistoryLoading') }}
      </VaAlert>
      <VaAlert v-else-if="!props.contractHistory?.length" color="secondary" outline>
        {{ $t('clients.historyPlaceholder') }}
      </VaAlert>
      <div v-else class="contract-history-list">
        <div v-for="item in props.contractHistory" :key="item.id" class="contract-history-row">
          <div>
            <div class="contract-history-number">{{ item.contractNumber || '—' }}</div>
            <div class="contract-history-date">
              {{ new Date(item.createdAt).toLocaleString('ru-RU') }}
              <StatusBadge
                class="contract-history-status"
                :label="$t(`contracts.contractStatuses.${item.status || 'ACTIVE'}`)"
                :tone="contractStatusTone(item.status)"
              />
            </div>
          </div>
          <div class="contract-history-actions">
            <VaPopover v-if="item.status === 'ACTIVE'" :message="$t('contracts.pause')">
              <VaButton
                type="button"
                size="large"
                preset="plain"
                :icon="TableActionIcon.contractPause"
                @click="emit('pause-contract-history-item', item.id)"
              />
            </VaPopover>
            <VaPopover v-if="item.status === 'PAUSED'" :message="$t('contracts.resume')">
              <VaButton
                type="button"
                size="large"
                preset="plain"
                :icon="TableActionIcon.contractResume"
                @click="emit('resume-contract-history-item', item.id)"
              />
            </VaPopover>
            <VaPopover v-if="item.status !== 'CANCELLED' && item.status !== 'EXPIRED'" :message="$t('contracts.terminate')">
              <VaButton
                type="button"
                size="large"
                color="warning"
                preset="plain"
                :icon="TableActionIcon.contractTerminate"
                @click="emit('terminate-contract-history-item', item.id)"
              />
            </VaPopover>
          </div>
          <VaPopover :message="$t('clients.openContract')">
            <VaButton
              type="button"
              size="large"
              preset="plain"
              :icon="TableActionIcon.viewDocument"
              @click="emit('open-contract-history-item', item.id)"
            />
          </VaPopover>
        </div>
      </div>
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
  </div>
</template>

<style scoped>
.client-form-layout {
  display: grid;
  gap: 0.9rem;
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

.tabs-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  padding: 0.25rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
  background: color-mix(in srgb, var(--app-surface) 96%, white 4%);
}

.tabs-row :deep(.va-button) {
  --va-button-sm-height: 2.15rem;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
  padding: 0 0.8rem;
}

.tabs-row :deep(.va-button--secondary) {
  color: color-mix(in srgb, var(--app-text) 68%, var(--app-muted));
  background: transparent;
  border: 1px solid transparent;
}

.tabs-row :deep(.va-button--secondary:hover) {
  background: color-mix(in srgb, var(--app-surface) 90%, var(--app-border) 10%);
}

.tabs-row :deep(.va-button--primary) {
  color: color-mix(in srgb, white 94%, var(--app-text) 6%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 78%, white 22%);
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

.contract-panel {
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  border-radius: 10px;
  padding: 0.6rem;
  background: color-mix(in srgb, var(--app-surface) 97%, white 3%);
}

.contract-panel__title {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-muted);
  margin-bottom: 0.45rem;
}

.contract-panel__status {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.5rem;
}

.contract-panel__pause {
  font-size: 0.8rem;
  color: var(--app-muted);
}

.contract-panel__hint {
  margin-bottom: 0.5rem;
}

.contract-empty-state {
  margin-bottom: 0.5rem;
  border: 1px dashed color-mix(in srgb, var(--app-border) 84%, transparent);
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: color-mix(in srgb, var(--app-muted) 78%, var(--app-text));
  font-size: 0.86rem;
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

.photo-upload-alert {
  grid-column: 1 / -1;
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
.photo-placeholder { font-size: 0.8rem; color: var(--app-muted); text-align: center; padding: 0 0.5rem; }

.photo-preview__delete {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: inherit;
  background: color-mix(in srgb, rgba(0, 0, 0, 0.5) 100%, transparent);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.photo-preview--deletable:hover .photo-preview__delete,
.photo-preview--deletable:focus-within .photo-preview__delete {
  opacity: 1;
  pointer-events: auto;
}

.photo-preview__delete:hover:not(:disabled) {
  background: color-mix(in srgb, rgba(0, 0, 0, 0.62) 100%, transparent);
}

.photo-preview__delete:disabled {
  cursor: not-allowed;
}

.photo-upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  border-radius: 8px;
  padding: 0 0.8rem;
  cursor: pointer;
  font-weight: 600;
}
.photo-upload input { display: none; }

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
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 84%, transparent);
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
}

.contract-history-number {
  font-weight: 600;
}

.contract-history-date {
  margin-top: 0.1rem;
  font-size: 0.8rem;
  color: var(--app-muted);
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.contract-history-status {
  flex-shrink: 0;
}

.contract-history-actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.contract-history-actions :deep(.va-button),
.contract-history-row > :deep(.va-button) {
  min-width: 2.2rem;
  min-height: 2.2rem;
  padding: 0;
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
</style>
