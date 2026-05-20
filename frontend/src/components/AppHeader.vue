<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAppPreferencesStore } from '@/stores/appPreferences'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useToast } from 'vuestic-ui'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { useScannerModalUrlSync } from '@/composables/useScannerModalUrlSync'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { api } from '@/utils/api'
import { clientPhotoDisplayUrl } from '@/utils/clientPhotoUrl'
import axios from 'axios'
const props = withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  { compact: false },
)

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const prefs = useAppPreferencesStore()
const auth = useAuthStore()
const ui = useUiStore()
const { init: notify } = useToast()

/** После входа/выхода/force-close обновляем оба реестра: и «в зале», и журнал (keep-alive и переходы между разделами). */
function refreshRegistriesAfterVisitMutation() {
  ui.bumpClientsTableRefresh()
  ui.bumpVisitsTableRefresh()
}

/** Создание клиента из сканера — администратор и менеджер. */
const canCreateClientFromScanner = computed(() => {
  const r = auth.user?.role
  return r === 'ADMIN' || r === 'MANAGER'
})
const now = ref(new Date())
const scannerOpen = ref(false)
const scannerInputValue = ref('')
const scannerHint = ref<string | null>(null)
const scannerModalRef = ref<HTMLElement | null>(null)
const scannerLoading = ref(false)
const scannerLockerNumber = ref('')
const scannerLockerInputRef = ref<HTMLInputElement | null>(null)
const SCANNER_LOCKER_MAX_LEN = 4
const scannerClientCard = ref<{
  id: string
  fullName: string
  phone: string
  cardNumber: string | null
  status: string
  photoUrl?: string | null
  contractUnpaid?: { contractNumber: string; balanceDue: string } | null
} | null>(null)
const scannerPhotoLoadFailed = ref(false)
const scannerClientPhotoSrc = computed(() => clientPhotoDisplayUrl(scannerClientCard.value?.photoUrl))
const scannerPhotoShowImg = computed(
  () => Boolean(scannerClientPhotoSrc.value) && !scannerPhotoLoadFailed.value,
)

function onScannerPhotoError() {
  scannerPhotoLoadFailed.value = true
}

watch(
  () => [scannerClientCard.value?.id, scannerClientCard.value?.photoUrl] as const,
  () => {
    scannerPhotoLoadFailed.value = false
  },
)
const scannerVisitStatus = ref<'IN_GYM' | 'OVERDUE' | 'LEFT' | 'FORCE_CLOSED' | null>(null)
const scannerCurrentLocker = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

/** «Бургер» для выезда сайдбара на узком экране (см. AppSidebar). */
const isMobileNav = ref(false)
let navMq: MediaQueryList | null = null
let navMqListener: ((e: MediaQueryListEvent) => void) | null = null

const showMobileNavButton = computed(
  () => !props.compact && Boolean(auth.user) && isMobileNav.value,
)

type ScannerHintTone = 'default' | 'notFound' | 'error' | 'searching' | 'callout'

/** Visual emphasis for lookup result (not found / error). */
const scannerHintTone = ref<ScannerHintTone>('default')

function isLookupNotFoundError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  if (error.response?.status === 404) return true
  const data = error.response?.data as { code?: string } | undefined
  return data?.code === 'CLIENT_NOT_FOUND'
}

function onScannerCodeInput() {
  if (scannerClientCard.value) return
  if (
    scannerHintTone.value === 'notFound' ||
    scannerHintTone.value === 'error' ||
    scannerHintTone.value === 'callout'
  ) {
    scannerHintTone.value = 'default'
    scannerHint.value = null
  }
}

/** Only ACTIVE clients may enter per club rules — highlight others (no valid membership / paused / blocked). */
const scannerClientEntryNotAllowed = computed(
  () => Boolean(scannerClientCard.value && scannerClientCard.value.status !== 'ACTIVE'),
)

/** Незакрытая сессия: IN_GYM — обычный выход; OVERDUE (после 00:00) — выход через «ключ сдан / не сдан». */
const scannerHasOpenVisit = computed(
  () => scannerVisitStatus.value === 'IN_GYM' || scannerVisitStatus.value === 'OVERDUE',
)

function scannerClientStatusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'PAUSED') return 'warning'
  if (status === 'BLOCKED') return 'danger'
  return 'neutral'
}

const scannerVisitBadgeLabel = computed(() => {
  if (scannerHasOpenVisit.value) {
    if (scannerVisitStatus.value === 'OVERDUE') {
      return t('header.scannerOverdueWithLocker', { locker: scannerCurrentLocker.value || '—' })
    }
    return t('header.scannerInGymWithLocker', { locker: scannerCurrentLocker.value || '—' })
  }
  return t('header.scannerNotInGymLabel')
})

const scannerVisitBadgeTone = computed((): 'success' | 'warning' | 'info' => {
  if (scannerVisitStatus.value === 'IN_GYM') return 'success'
  if (scannerVisitStatus.value === 'OVERDUE') return 'warning'
  return 'info'
})

const showScannerBottomHint = computed(() => {
  if (scannerHintTone.value === 'searching' || scannerHintTone.value === 'notFound' || scannerHintTone.value === 'error') {
    return true
  }
  if (scannerClientCard.value) {
    if (scannerHasOpenVisit.value && scannerHint.value) return true
    if (scannerClientEntryNotAllowed.value && scannerHint.value) return true
    return false
  }
  return Boolean(scannerHint.value) || scannerHintTone.value === 'default'
})

function onScannerLockerNativeInput(event: Event) {
  const el = event.target as HTMLInputElement
  const next = el.value.replace(/\D/g, '').slice(0, SCANNER_LOCKER_MAX_LEN)
  scannerLockerNumber.value = next
  if (el.value !== next) el.value = next
}

function onScannerLockerKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const key = event.key
  if (key === 'Backspace' || key === 'Delete' || key === 'Tab' || key === 'Enter' || key.startsWith('Arrow')) {
    return
  }
  if (/^\d$/.test(key)) return
  event.preventDefault()
}

function focusScannerInput() {
  const root = scannerModalRef.value
  if (!root) return
  const input = root.querySelector('input') as HTMLInputElement | null
  input?.focus()
  input?.select()
}

/** Поле шкафчика монтируется по v-if — после успешного lookup активного клиента вне зала. */
function focusScannerLockerInput() {
  void nextTick(() => {
    const input = scannerLockerInputRef.value
    input?.focus()
    input?.select()
  })
}

function openScannerModal() {
  scannerHint.value = null
  scannerHintTone.value = 'default'
  scannerOpen.value = true
}

function closeScannerModal() {
  scannerOpen.value = false
  scannerLoading.value = false
}

function startCreateClientFromUnknownCard() {
  const code = scannerInputValue.value.trim()
  if (!code) return
  ui.requestCreateClientFromScanner(code)
  closeScannerModal()
}

/** Открыть модалку редактирования клиента на странице «Клиенты». */
async function goToClientProfile() {
  const id = scannerClientCard.value?.id
  if (!id) return
  ui.setScannerTargetClientId(id)
  closeScannerModal()
  if (router.currentRoute.value.name !== 'clients') {
    await router.push({ name: 'clients' })
  }
}

function clearScannerResolvedState() {
  scannerClientCard.value = null
  scannerVisitStatus.value = null
  scannerCurrentLocker.value = null
  scannerLockerNumber.value = ''
}

/** Сбросить найденного клиента и ввести другой код (кнопка вместо дублирующего «Найти»). */
function prepareAnotherScannerLookup() {
  clearScannerResolvedState()
  scannerHint.value = null
  scannerHintTone.value = 'default'
  scannerInputValue.value = ''
  void nextTick(() => focusScannerInput())
}

async function onScannerSubmit() {
  const code = scannerInputValue.value.trim()
  if (!code) {
    scannerHintTone.value = 'callout'
    scannerHint.value = t('header.scannerEmpty')
    return
  }
  scannerLoading.value = true
  scannerHintTone.value = 'searching'
  scannerHint.value = t('header.scannerSearching')
  let focusLockerAfterLookup = false
  try {
    const { data } = await api.get('/visits/lookup', { params: { code } })
    const payload = data as {
      client: {
        id: string
        fullName: string
        phone: string
        cardNumber: string | null
        status: string
        photoUrl?: string | null
        contractUnpaid?: { contractNumber: string; balanceDue: string } | null
      }
      inGym: boolean
      openSession?: { lockerNumber: string; status: 'IN_GYM' | 'OVERDUE' | 'LEFT' | 'FORCE_CLOSED' } | null
    }
    scannerClientCard.value = payload.client
    scannerVisitStatus.value = payload.openSession?.status ?? null
    scannerCurrentLocker.value = payload.openSession?.lockerNumber ?? null
    scannerLockerNumber.value = (payload.openSession?.lockerNumber ?? '')
      .replace(/\D/g, '')
      .slice(0, SCANNER_LOCKER_MAX_LEN)
    scannerHintTone.value = 'default'
    if (payload.inGym) {
      scannerHint.value = t('header.scannerClientInGym')
    } else if (payload.openSession?.status === 'OVERDUE') {
      scannerHintTone.value = 'callout'
      scannerHint.value = t('header.scannerOverdueCloseFirstHint')
    } else if (payload.client.status === 'BLOCKED') {
      scannerHint.value = t('header.scannerClientBlockedHint')
    } else if (payload.client.status !== 'ACTIVE') {
      scannerHint.value = t('header.scannerInactiveLookupHint')
    } else {
      scannerHint.value = null
      scannerHintTone.value = 'default'
    }
    focusLockerAfterLookup = !payload.openSession && payload.client.status === 'ACTIVE'
  } catch (error: unknown) {
    clearScannerResolvedState()
    scannerHintTone.value = isLookupNotFoundError(error) ? 'notFound' : 'error'
    scannerHint.value = resolveApiErrorMessage(error, {
      defaultMessage: t('header.scannerLookupFailed'),
      byStatus: { 404: t('header.scannerCardNotInDatabase') },
      byCode: {
        CLIENT_NOT_FOUND: t('header.scannerCardNotInDatabase'),
      },
    })
  } finally {
    scannerLoading.value = false
  }
  if (focusLockerAfterLookup) {
    await nextTick()
    await nextTick()
    requestAnimationFrame(() => {
      focusScannerLockerInput()
    })
  }
}

async function scannerCheckIn() {
  const code = scannerInputValue.value.trim()
  const lockerNumber = scannerLockerNumber.value.trim()
  if (!code || !lockerNumber) {
    scannerHintTone.value = 'callout'
    scannerHint.value = t('header.scannerLockerRequired')
    return
  }
  scannerLoading.value = true
  try {
    await api.post('/visits/check-in', { code, lockerNumber })
    notify({ color: 'success', message: t('header.scannerCheckInSuccess', { locker: lockerNumber }) })
    refreshRegistriesAfterVisitMutation()
    closeScannerModal()
  } catch (error: unknown) {
    scannerHintTone.value = 'error'
    scannerHint.value = resolveApiErrorMessage(error, {
      defaultMessage: t('header.scannerCheckInFailed'),
      byCode: {
        ONLY_ACTIVE_ALLOWED: t('header.scannerOnlyActiveAllowed'),
        OPEN_VISIT_EXISTS: t('header.scannerOpenVisitExists'),
        ALREADY_IN_GYM: t('header.scannerAlreadyInGym'),
        LOCKER_BUSY: t('header.scannerLockerBusy'),
        LOCKER_REQUIRED: t('header.scannerLockerRequired'),
      },
    })
  } finally {
    scannerLoading.value = false
  }
}

async function scannerCheckOut() {
  const code = scannerInputValue.value.trim()
  if (!code) return
  scannerLoading.value = true
  try {
    await api.post('/visits/check-out', { code })
    notify({ color: 'success', message: t('header.scannerCheckOutSuccess') })
    refreshRegistriesAfterVisitMutation()
    closeScannerModal()
  } catch (error: unknown) {
    scannerHint.value = resolveApiErrorMessage(error, {
      defaultMessage: t('header.scannerCheckOutFailed'),
      byCode: {
        NOT_IN_GYM: t('header.scannerNotInGym'),
      },
    })
  } finally {
    scannerLoading.value = false
  }
}

async function scannerForceClose(reason: 'LOST_KEY' | 'FOUND_LATER' | 'ADMIN_CORRECTION') {
  const code = scannerInputValue.value.trim()
  if (!code) return
  scannerLoading.value = true
  try {
    await api.post('/visits/force-close', { code, reason })
    notify({ color: 'success', message: t('header.scannerCheckOutSuccess') })
    refreshRegistriesAfterVisitMutation()
    closeScannerModal()
  } catch (error: unknown) {
    scannerHint.value = resolveApiErrorMessage(error, {
      defaultMessage: t('header.scannerForceCloseFailed'),
      byCode: {
        NOT_IN_GYM: t('header.scannerNotInGym'),
      },
    })
  } finally {
    scannerLoading.value = false
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  const isF11 = event.key === 'F11'
  const isMacScanner = event.metaKey && event.shiftKey && event.key.toLowerCase() === 'k'
  if (!isF11 && !isMacScanner) return
  if (props.compact) return
  event.preventDefault()
  openScannerModal()
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
  window.addEventListener('keydown', onGlobalKeydown)
  navMq = window.matchMedia('(max-width: 960px)')
  isMobileNav.value = navMq.matches
  navMqListener = (e: MediaQueryListEvent) => {
    isMobileNav.value = e.matches
    if (!e.matches) ui.closeMobileSidebar()
  }
  navMq.addEventListener('change', navMqListener)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onGlobalKeydown)
  if (navMq && navMqListener) navMq.removeEventListener('change', navMqListener)
})

watch(scannerOpen, async (open, prevOpen) => {
  if (!open) {
    if (prevOpen === true && router.currentRoute.value.name === 'clients') {
      ui.bumpClientsTableRefresh()
    }
    scannerInputValue.value = ''
    scannerHint.value = null
    scannerHintTone.value = 'default'
    clearScannerResolvedState()
    return
  }
  await nextTick()
  focusScannerInput()
})

watch(
  () => ui.scannerLookupTick,
  async () => {
    const code = ui.scannerLookupCode.trim()
    if (!code) return
    clearScannerResolvedState()
    scannerHint.value = null
    scannerHintTone.value = 'default'
    scannerInputValue.value = code
    scannerOpen.value = true
    await nextTick()
    focusScannerInput()
    await onScannerSubmit()
  },
)

useScannerModalUrlSync(route, router, {
  compact: computed(() => props.compact),
  scannerOpen,
  scannerInputValue,
  isRouteSyncBlocked: () => scannerLoading.value,
  applyFromRoute: async (parsed) => {
    if (!parsed.shouldOpen) {
      if (scannerOpen.value) {
        scannerOpen.value = false
        scannerLoading.value = false
      }
      return
    }

    const nextCode = parsed.code
    const codeChanged = nextCode !== scannerInputValue.value.trim()
    const needsLookup =
      Boolean(nextCode) &&
      !scannerLoading.value &&
      (!scannerClientCard.value || codeChanged)

    scannerHint.value = null
    scannerHintTone.value = 'default'
    if (codeChanged) {
      clearScannerResolvedState()
      scannerInputValue.value = nextCode
    }

    if (!scannerOpen.value) {
      scannerOpen.value = true
    } else if (needsLookup) {
      await nextTick()
      focusScannerInput()
    }

    if (needsLookup) {
      await onScannerSubmit()
    }
  },
})

const clockDate = computed(() => {
  const raw = new Intl.DateTimeFormat(prefs.locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(now.value)
  return raw.replace(/[\s\u00a0]*г\.?[\s\u00a0]*$/iu, '').trim()
})

/** Короткая дата для узкого хедера (напр. 13.05.26). */
const clockDateShort = computed(() =>
  new Intl.DateTimeFormat(prefs.locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(now.value),
)

const displayClockDate = computed(() =>
  isMobileNav.value ? clockDateShort.value : clockDate.value,
)

const clockTime = computed(() =>
  new Intl.DateTimeFormat(prefs.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now.value),
)

</script>

<template>
  <div class="app-header-shell">
    <VaNavbar
      class="app-header rounded-2xl"
      :class="{ 'app-header--mobile-bar': isMobileNav && !props.compact }"
    >
      <template #left>
        <div class="nav-left">
          <VaButton
            v-if="showMobileNavButton"
            :icon="ui.mobileSidebarOpen ? 'close' : 'menu'"
            preset="plain"
            color="primary"
            class="header-mobile-nav-btn"
            :aria-label="ui.mobileSidebarOpen ? t('header.closeNav') : t('header.openNav')"
            :aria-expanded="ui.mobileSidebarOpen ? 'true' : 'false'"
            @click="ui.toggleMobileSidebar()"
          />
          <RouterLink to="/" class="brand-link" :aria-label="t('header.logoAlt')">
            <img
              class="brand-logo"
              src="/images/logo.png"
              alt=""
              width="56"
              height="56"
              decoding="async"
            />
          </RouterLink>
        </div>
      </template>

      <template #center v-if="!props.compact">
        <div class="header-clock-wrap">
          <div class="header-clock" :class="{ 'header-clock--compact': isMobileNav }">
            <span class="header-clock__date">{{ displayClockDate }}</span>
            <template v-if="isMobileNav">
              <span class="header-clock__time">{{ clockTime }}</span>
            </template>
            <template v-else>
              <span class="header-clock__sep">, </span>
              <span class="header-clock__time">{{ clockTime }}</span>
            </template>
          </div>
        </div>
      </template>

      <template #right>
        <div v-if="!props.compact" class="header-tools">
          <VaButton
            icon="qr_code_scanner"
            preset="secondary"
            color="primary"
            class="header-scan-btn"
            size="medium"
            :aria-label="t('header.scanClient')"
            @click="openScannerModal"
          />
        </div>
      </template>
    </VaNavbar>

    <VaModal
      v-model="scannerOpen"
      hide-default-actions
      no-padding
      no-outside-dismiss
      max-width="min(96vw, 540px)"
      class="scanner-modal-shell"
    >
      <div ref="scannerModalRef" class="scanner-modal">
        <header class="scanner-modal__header">
          <div class="scanner-modal__lead">
            <div class="scanner-modal__icon" aria-hidden="true">
              <VaIcon name="qr_code_scanner" size="22px" />
            </div>
            <div class="scanner-modal__head-copy">
              <h3 class="scanner-modal__title">{{ t('header.scannerTitle') }}</h3>
              <p class="scanner-modal__subtitle">{{ t('header.scannerSubtitle') }}</p>
            </div>
          </div>
          <button
            type="button"
            class="scanner-modal__close"
            :aria-label="t('header.closeScanner')"
            @click="closeScannerModal"
          >
            <VaIcon name="close" size="22px" />
          </button>
        </header>

        <form id="scanner-lookup-form" class="scanner-modal__body" @submit.prevent="onScannerSubmit">
          <section
            class="scanner-modal__card scanner-modal__code-wrap"
            :class="{
              'scanner-modal__code-wrap--not-found': scannerHintTone === 'notFound',
              'scanner-modal__code-wrap--locked': Boolean(scannerClientCard),
            }"
          >
            <VaInput
              v-model="scannerInputValue"
              :label="t('header.scannerInputLabel')"
              autocomplete="off"
              autofocus
              :readonly="Boolean(scannerClientCard)"
              :disabled="scannerLoading"
              @keydown.enter.prevent="onScannerSubmit"
              @update:model-value="onScannerCodeInput"
            />
          </section>
          <div
            v-if="scannerClientCard"
            class="scanner-pass-card"
            :class="{
              'scanner-pass-card--entry-blocked': scannerClientEntryNotAllowed,
              'scanner-pass-card--in-gym':
                scannerVisitStatus === 'IN_GYM' && !scannerClientEntryNotAllowed,
              'scanner-pass-card--overdue-visit':
                scannerVisitStatus === 'OVERDUE' && !scannerClientEntryNotAllowed,
            }"
            role="group"
          >
            <div
              v-if="scannerClientEntryNotAllowed"
              class="scanner-pass-card__banner scanner-pass-card__banner--danger"
              role="status"
            >
              {{
                scannerClientCard?.status === 'BLOCKED'
                  ? t('header.scannerBlockedClientBanner')
                  : t('header.scannerInactiveClientBanner')
              }}
            </div>
            <div
              v-if="scannerClientCard.contractUnpaid"
              class="scanner-pass-card__banner scanner-pass-card__banner--warning"
              role="alert"
            >
              {{
                t('header.scannerContractUnpaidBanner', {
                  number: scannerClientCard.contractUnpaid.contractNumber,
                  balance: scannerClientCard.contractUnpaid.balanceDue,
                })
              }}
            </div>

            <div class="scanner-pass-card__main">
              <div class="scanner-pass-card__photo-wrap">
                <div class="scanner-pass-card__photo" aria-hidden="true">
                  <img
                    v-if="scannerPhotoShowImg"
                    class="scanner-pass-card__photo-img"
                    :src="scannerClientPhotoSrc"
                    alt=""
                    @error="onScannerPhotoError"
                  />
                  <VaIcon v-else name="person" class="scanner-pass-card__photo-placeholder" size="72px" />
                </div>
              </div>

              <div class="scanner-pass-card__info">
                <div class="scanner-pass-card__name-row">
                  <h4 class="scanner-pass-card__name">{{ scannerClientCard.fullName }}</h4>
                  <VaButton
                    type="button"
                    preset="plain"
                    color="primary"
                    size="medium"
                    icon="open_in_new"
                    class="scanner-pass-card__profile-btn"
                    :aria-label="t('header.openClientProfile')"
                    :title="t('header.openClientProfile')"
                    @click.stop="goToClientProfile"
                  />
                </div>
                <div class="scanner-pass-card__phone">{{ scannerClientCard.phone }}</div>
                <div class="scanner-pass-card__badges">
                  <StatusBadge
                    :label="t(`clients.status.${scannerClientCard.status}`)"
                    :tone="scannerClientStatusTone(scannerClientCard.status)"
                  />
                  <StatusBadge :label="scannerVisitBadgeLabel" :tone="scannerVisitBadgeTone" />
                </div>
              </div>
            </div>

            <div
              v-if="!scannerHasOpenVisit && !scannerClientEntryNotAllowed"
              class="scanner-pass-card__locker"
            >
              <label class="scanner-locker-field">
                <span class="scanner-locker-field__label">{{ t('header.scannerLockerLabel') }}</span>
                <input
                  ref="scannerLockerInputRef"
                  :value="scannerLockerNumber"
                  class="scanner-locker-field__input"
                  type="text"
                  inputmode="numeric"
                  maxlength="4"
                  autocomplete="off"
                  :disabled="scannerLoading"
                  @input="onScannerLockerNativeInput"
                  @keydown="onScannerLockerKeydown"
                  @keydown.enter.prevent="scannerCheckIn"
                />
              </label>
            </div>
          </div>
          <div
            v-if="showScannerBottomHint"
            class="scanner-modal__hint"
            :class="{
              'scanner-modal__hint--not-found': scannerHintTone === 'notFound',
              'scanner-modal__hint--error': scannerHintTone === 'error',
              'scanner-modal__hint--callout': scannerHintTone === 'callout',
            }"
            role="status"
          >
            <VaIcon
              v-if="scannerHintTone === 'notFound'"
              name="person_off"
              color="#b91c1c"
              class="scanner-modal__hint-icon"
              size="20px"
            />
            <VaIcon
              v-else-if="scannerHintTone === 'error'"
              name="error_outline"
              color="#b91c1c"
              class="scanner-modal__hint-icon"
              size="20px"
            />
            <VaIcon
              v-else-if="scannerHintTone === 'callout'"
              name="pin_drop"
              class="scanner-modal__hint-icon scanner-modal__hint-icon--callout"
              size="20px"
            />
            <span class="scanner-modal__hint-text">{{ scannerHint ?? t('header.scannerHint') }}</span>
          </div>
          <div v-if="scannerClientCard" class="scanner-modal__another-wrap">
            <VaButton
              type="button"
              preset="plain"
              size="small"
              color="primary"
              icon="qr_code_scanner"
              class="scanner-modal__another-btn"
              @click="prepareAnotherScannerLookup"
            >
              {{ t('header.scannerAnotherCode') }}
            </VaButton>
          </div>
        </form>

        <footer class="scanner-modal__footer">
          <div class="scanner-modal__actions">
            <VaButton
              v-if="!scannerClientCard"
              type="submit"
              form="scanner-lookup-form"
              size="large"
              icon="search"
              color="primary"
              class="scanner-modal__action-span"
              :loading="scannerLoading"
            >
              {{ t('header.findClient') }}
            </VaButton>
            <VaButton
              v-if="
                scannerHintTone === 'notFound' &&
                scannerInputValue.trim() &&
                canCreateClientFromScanner
              "
              type="button"
              size="large"
              icon="person_add"
              preset="secondary"
              class="scanner-modal__action-span"
              @click="startCreateClientFromUnknownCard"
            >
              {{ t('header.scannerCreateClientButton') }}
            </VaButton>
            <VaButton
              v-if="scannerClientCard && !scannerHasOpenVisit && !scannerClientEntryNotAllowed"
              type="button"
              size="large"
              icon="login"
              color="success"
              class="scanner-modal__action-span"
              :loading="scannerLoading"
              @click="scannerCheckIn"
            >
              {{ t('header.scannerCheckIn') }}
            </VaButton>
            <template v-if="scannerClientCard && scannerHasOpenVisit">
              <VaButton
                v-if="scannerVisitStatus === 'IN_GYM'"
                type="button"
                size="large"
                color="warning"
                icon="logout"
                class="scanner-modal__action-span"
                :loading="scannerLoading"
                @click="scannerCheckOut"
              >
                {{ t('header.scannerCheckOut') }}
              </VaButton>
              <div v-if="scannerVisitStatus === 'OVERDUE'" class="scanner-modal__force-close-span">
                <VaButton
                  type="button"
                  size="large"
                  preset="secondary"
                  color="primary"
                  icon="vpn_key"
                  class="scanner-modal__force-close-btn"
                  :loading="scannerLoading"
                  @click="scannerForceClose('ADMIN_CORRECTION')"
                >
                  {{ t('header.scannerForceCloseKeyReturned') }}
                </VaButton>
                <VaButton
                  type="button"
                  size="large"
                  color="danger"
                  icon="lock_reset"
                  class="scanner-modal__force-close-btn"
                  :loading="scannerLoading"
                  @click="scannerForceClose('LOST_KEY')"
                >
                  {{ t('header.scannerForceCloseNoKey') }}
                </VaButton>
              </div>
            </template>
          </div>
        </footer>
      </div>
    </VaModal>
  </div>
</template>

<style scoped>
.app-header-shell {
  display: contents;
}

.app-header {
  background: var(--app-surface) !important;
  border: none !important;
  color: var(--app-text);
  box-shadow: var(--app-shadow-soft);
  border-radius: 16px;
  --va-navbar-padding-y: 0.45rem;
  --va-navbar-padding-x: 0.65rem;
  --va-navbar-height: auto;
}

.app-header :deep(.va-navbar__right) {
  align-items: center;
}

@media (max-width: 960px) {
  .app-header {
    --va-navbar-padding-y: 0.5rem;
    --va-navbar-padding-x: 0.55rem;
  }

  .nav-left {
    gap: 0.55rem;
  }

  .brand-logo {
    width: 3.15rem;
    height: 3.15rem;
  }
}

/** Мобильная «карточка» под макет: нижнее скругление чуть сильнее, лёгкая тень. */
.app-header.app-header--mobile-bar {
  border-radius: 14px 14px 22px 22px;
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--app-border) 55%, transparent),
    0 10px 32px rgba(15, 23, 42, 0.07),
    0 4px 12px rgba(15, 23, 42, 0.04);
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

.header-mobile-nav-btn {
  flex-shrink: 0;
  min-width: 2.75rem;
  min-height: 2.75rem;
}

.brand-link {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  text-decoration: none;
  outline-offset: 2px;
}

.brand-link:hover .brand-logo {
  opacity: 0.88;
}

.brand-logo {
  width: 3.5rem;
  height: 3.5rem;
  object-fit: contain;
  border-radius: 50%;
  display: block;
}

.header-tools {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  min-width: 0;
}

.header-scan-btn {
  --va-button-md-height: 3.1rem;
  --va-button-md-width: 3.1rem;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 3.1rem !important;
  min-height: 3.1rem !important;
  width: 3.1rem !important;
  height: 3.1rem !important;
  padding: 0 !important;
  border-radius: 14px !important;
}

.header-scan-btn :deep(.va-button__content) {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  gap: 0 !important;
}

.header-scan-btn :deep(.material-icons),
.header-scan-btn :deep(.va-icon) {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 2rem !important;
  width: 2rem !important;
  height: 2rem !important;
  line-height: 1 !important;
  margin: 0 !important;
}

.header-clock-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  padding: 0 0.35rem;
}

.label {
  font-size: 0.75rem;
  color: var(--app-muted);
}

.header-clock {
  color: var(--app-muted);
  font-size: 0.84rem;
  text-transform: capitalize;
  font-variant-numeric: tabular-nums;
  text-align: center;
  line-height: 1.25;
  white-space: nowrap;
}

.header-clock__time {
  font-weight: 600;
}

.header-clock--compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.12rem;
  text-transform: none;
  font-size: 0.78rem;
}

.header-clock--compact .header-clock__date {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: color-mix(in srgb, var(--app-muted) 88%, var(--app-text) 12%);
}

.header-clock--compact .header-clock__time {
  font-weight: 800;
  font-size: 1.08rem;
  letter-spacing: 0.02em;
  line-height: 1.15;
  color: var(--app-text);
}

.scanner-modal {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--app-surface);
}

.scanner-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0.8rem;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 78%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-accent) 5%, var(--app-surface)) 0%,
    var(--app-surface) 100%
  );
}

.scanner-modal__lead {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  min-width: 0;
}

.scanner-modal__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--app-accent) 14%, var(--app-surface));
  color: var(--app-accent);
  flex-shrink: 0;
}

.scanner-modal__head-copy {
  min-width: 0;
}

.scanner-modal__close {
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

.scanner-modal__close:hover {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 86%, var(--app-border) 14%);
}

.scanner-modal__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
  outline-offset: 2px;
}

.scanner-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--app-text);
  line-height: 1.3;
}

.scanner-modal__subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: var(--app-muted);
  line-height: 1.4;
}

.scanner-modal__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.scanner-modal__card {
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--app-accent) 16%, var(--app-border));
  background: color-mix(in srgb, var(--app-surface) 98%, white 2%);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-text) 4%, transparent);
}

.scanner-modal__body :deep(.scanner-modal__code-wrap .va-input-wrapper) {
  width: 100%;
  display: block;
  margin-bottom: 0;
}

.scanner-modal__body :deep(.va-input-wrapper__field) {
  min-height: 2.5rem;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.scanner-modal__code-wrap {
  width: 100%;
  box-sizing: border-box;
  padding: 0.75rem 0.85rem 0.7rem;
  transition:
    box-shadow 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.scanner-modal__code-wrap--not-found {
  border-color: color-mix(in srgb, var(--va-danger) 52%, var(--app-border));
  background: color-mix(in srgb, var(--va-danger) 6%, var(--app-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--va-danger) 18%, transparent);
}

.scanner-modal__code-wrap--not-found :deep(.va-input-wrapper) {
  --va-input-wrapper-border-width: 0;
  --va-input-wrapper-background-opacity: 0;
}

.scanner-modal__code-wrap--not-found :deep(.va-input-wrapper--focused) {
  --va-input-wrapper-border-width: 0;
}

.scanner-modal__code-wrap--not-found :deep(.va-input-wrapper__field) {
  border: none !important;
  box-shadow: none !important;
}

.scanner-modal__code-wrap--not-found :deep(.va-input-wrapper__field::after) {
  opacity: 0;
}

.scanner-modal__code-wrap--locked :deep(.va-input-wrapper__field) {
  cursor: default;
  user-select: all;
  background: color-mix(in srgb, var(--app-muted) 8%, var(--app-surface));
  color: var(--app-text);
  font-weight: 700;
}

.scanner-modal__footer {
  padding: 0.75rem 1rem 0.9rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
  background: color-mix(in srgb, var(--app-text) 2.5%, var(--app-surface));
}

.scanner-modal__hint {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.8125rem;
  color: var(--app-muted);
  min-height: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-text) 3%, var(--app-surface));
  border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
}

.scanner-modal__hint-text {
  flex: 1;
  min-width: 0;
  line-height: 1.38;
}

.scanner-modal__hint-icon {
  flex-shrink: 0;
  margin-top: 0.02rem;
}

.scanner-modal__hint--not-found {
  color: #991b1b;
  font-weight: 600;
  font-size: 0.82rem;
  padding: 0.4rem 0.55rem;
  border-radius: 9px;
  background: rgba(220, 38, 38, 0.12);
  border: 1px solid rgba(220, 38, 38, 0.45);
}

.scanner-modal__hint--error {
  color: #991b1b;
  font-weight: 600;
  font-size: 0.82rem;
  padding: 0.4rem 0.55rem;
  border-radius: 9px;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.38);
}

/* Светлый текст на более насыщенном фоне — читаемо на тёмной теме. */
.scanner-modal__hint--callout {
  color: #fffbeb;
  font-weight: 700;
  font-size: 0.84rem;
  padding: 0.42rem 0.55rem;
  border-radius: 9px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #c2410c 52%, var(--app-surface)) 0%,
    color-mix(in srgb, #9a3412 48%, var(--app-surface)) 100%
  );
  border: 1px solid rgba(251, 191, 36, 0.42);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.2);
}

.scanner-modal__hint--callout .scanner-modal__hint-text {
  font-weight: 700;
  letter-spacing: 0.01em;
  color: inherit;
}

.scanner-modal__hint-icon--callout {
  color: #fde047;
}

.scanner-pass-card {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  border-radius: 14px;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: color-mix(in srgb, var(--app-surface) 98%, var(--app-bg-end));
}

.scanner-pass-card--in-gym {
  border-color: color-mix(in srgb, var(--va-success) 34%, var(--app-border));
  background: color-mix(in srgb, var(--va-success) 5%, var(--app-surface));
}

.scanner-pass-card--overdue-visit {
  border-color: color-mix(in srgb, #ea580c 34%, var(--app-border));
  background: color-mix(in srgb, #ea580c 5%, var(--app-surface));
}

.scanner-pass-card--entry-blocked {
  border-color: color-mix(in srgb, var(--va-danger) 42%, var(--app-border));
  background: color-mix(in srgb, var(--va-danger) 5%, var(--app-surface));
}

.scanner-pass-card__banner {
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.4;
}

.scanner-pass-card__banner--danger {
  color: color-mix(in srgb, var(--va-danger) 82%, var(--app-text));
  background: color-mix(in srgb, var(--va-danger) 8%, var(--app-surface));
  border: 1px solid color-mix(in srgb, var(--va-danger) 24%, var(--app-border));
}

.scanner-pass-card__banner--warning {
  color: color-mix(in srgb, #b45309 84%, var(--app-text));
  background: color-mix(in srgb, var(--va-warning) 8%, var(--app-surface));
  border: 1px solid color-mix(in srgb, var(--va-warning) 24%, var(--app-border));
}

.scanner-pass-card__main {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}

.scanner-pass-card__photo-wrap {
  display: flex;
  justify-content: center;
}

.scanner-pass-card__photo {
  width: min(100%, 15.5rem);
  aspect-ratio: 4 / 5;
  max-height: 18.5rem;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
  background: color-mix(in srgb, var(--app-text) 4%, var(--app-surface));
  box-shadow: 0 8px 24px color-mix(in srgb, var(--app-text) 8%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.scanner-pass-card__photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scanner-pass-card__photo-placeholder {
  color: color-mix(in srgb, var(--app-muted) 58%, var(--app-text));
}

.scanner-pass-card__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
}

.scanner-pass-card__name-row {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
}

.scanner-pass-card__name {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.28;
  color: var(--app-text);
}

.scanner-pass-card__profile-btn {
  flex-shrink: 0;
  margin: -0.2rem -0.15rem 0 0;
  min-width: 2.5rem !important;
  min-height: 2.5rem !important;
}

.scanner-pass-card__profile-btn :deep(.va-icon),
.scanner-pass-card__profile-btn :deep(.material-icons) {
  font-size: 1.45rem !important;
}

.scanner-pass-card__phone {
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--app-text) 62%, transparent);
  line-height: 1.35;
}

.scanner-pass-card__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
  margin-top: 0.15rem;
}

.scanner-pass-card__locker {
  display: flex;
  justify-content: center;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 88%, transparent);
}

.scanner-locker-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
}

.scanner-locker-field__label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--va-secondary, #6b7280);
  text-align: center;
  line-height: 1.25;
}

.scanner-locker-field__input {
  box-sizing: border-box;
  width: 6.75rem;
  height: var(--app-control-height, 2.75rem);
  margin: 0;
  padding: 0 0.45rem;
  border: 1px solid color-mix(in srgb, var(--app-border) 92%, transparent);
  border-radius: 10px;
  background: var(--app-surface);
  color: var(--app-text);
  text-align: center;
  font: inherit;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  font-variant-numeric: tabular-nums;
}

.scanner-locker-field__input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--va-primary) 72%, var(--app-border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--va-primary) 16%, transparent);
}

.scanner-locker-field__input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.scanner-modal__another-wrap {
  display: flex;
  justify-content: center;
  margin: 0;
}

.scanner-modal__another-btn {
  font-weight: 600;
  min-height: 0 !important;
  padding-top: 0.15rem !important;
  padding-bottom: 0.15rem !important;
}

.scanner-modal__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  gap: 0.55rem;
  align-items: stretch;
}

.scanner-modal__action-span {
  grid-column: 1 / -1;
}

.scanner-modal__action-split {
  min-width: 0;
}

.scanner-modal__footer :deep(.va-button) {
  width: 100%;
  justify-content: center;
  min-height: 2.75rem;
  padding-top: 0.5rem !important;
  padding-bottom: 0.5rem !important;
  font-size: 0.9375rem !important;
  font-weight: 700 !important;
  border-radius: 12px !important;
  letter-spacing: 0.01em;
}

.scanner-modal__footer :deep(.va-button[type='submit']) {
  box-shadow: 0 2px 10px color-mix(in srgb, var(--app-accent) 26%, transparent);
}

.scanner-modal__footer :deep(.va-button__content) {
  gap: 0.5rem;
}

.scanner-modal__force-close-span {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
  width: 100%;
}

.scanner-modal__force-close-btn {
  min-width: 0;
}

@media (max-width: 440px) {
  .scanner-modal__actions {
    grid-template-columns: 1fr;
  }

  .scanner-modal__action-split {
    grid-column: 1 / -1;
  }

  .scanner-modal__force-close-span {
    grid-template-columns: 1fr;
  }
}
</style>
