<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { useAppPreferencesStore } from '@/stores/appPreferences'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useToast } from 'vuestic-ui'
import { resolveApiErrorMessage } from '@/composables/useApiErrorMap'
import { api } from '@/utils/api'
import axios from 'axios'
const props = withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  { compact: false },
)

const { t } = useI18n()
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
const scannerClientCard = ref<{
  id: string
  fullName: string
  phone: string
  cardNumber: string | null
  status: string
} | null>(null)
const scannerClientInGym = ref(false)
const scannerVisitStatus = ref<'IN_GYM' | 'OVERDUE' | 'LEFT' | 'FORCE_CLOSED' | null>(null)
const scannerCurrentLocker = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

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

function focusScannerInput() {
  const root = scannerModalRef.value
  if (!root) return
  const input = root.querySelector('input') as HTMLInputElement | null
  input?.focus()
  input?.select()
}

/** Поле шкафчика монтируется по v-if — после успешного lookup активного клиента вне зала. */
function focusScannerLockerInput() {
  const root = scannerModalRef.value
  if (!root) return
  const input = root.querySelector(
    '.scanner-modal__locker-field input',
  ) as HTMLInputElement | null
  input?.focus()
  input?.select()
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
  scannerClientInGym.value = false
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
      client: { id: string; fullName: string; phone: string; cardNumber: string | null; status: string }
      inGym: boolean
      openSession?: { lockerNumber: string; status: 'IN_GYM' | 'OVERDUE' | 'LEFT' | 'FORCE_CLOSED' } | null
    }
    scannerClientCard.value = payload.client
    scannerClientInGym.value = Boolean(payload.inGym)
    scannerVisitStatus.value = payload.openSession?.status ?? null
    scannerCurrentLocker.value = payload.openSession?.lockerNumber ?? null
    scannerLockerNumber.value = payload.openSession?.lockerNumber ?? ''
    scannerHintTone.value = 'default'
    if (payload.inGym) {
      scannerHint.value = t('header.scannerClientInGym')
    } else if (payload.client.status === 'BLOCKED') {
      scannerHint.value = t('header.scannerClientBlockedHint')
    } else if (payload.client.status !== 'ACTIVE') {
      scannerHint.value = t('header.scannerInactiveLookupHint')
    } else {
      scannerHintTone.value = 'callout'
      scannerHint.value = t('header.scannerClientNotInGym')
    }
    focusLockerAfterLookup = !payload.inGym && payload.client.status === 'ACTIVE'
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

async function scannerForceClose(reason: 'LOST_KEY' | 'FOUND_LATER' = 'LOST_KEY') {
  const code = scannerInputValue.value.trim()
  if (!code) return
  scannerLoading.value = true
  try {
    await api.post('/visits/force-close', { code, reason })
    notify({ color: 'success', message: t('header.scannerForceCloseSuccess') })
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
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onGlobalKeydown)
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

const clockDate = computed(() => {
  const raw = new Intl.DateTimeFormat(prefs.locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(now.value)
  return raw.replace(/[\s\u00a0]*г\.?[\s\u00a0]*$/iu, '').trim()
})

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
    <VaNavbar class="app-header rounded-2xl">
      <template #left>
        <div class="nav-left">
          <RouterLink to="/" class="brand-title">{{ t('header.logoPlaceholder') }}</RouterLink>
        </div>
      </template>

      <template #right>
        <div v-if="!props.compact" class="header-tools">
          <VaButton
            size="small"
            icon="qr_code_scanner"
            preset="secondary"
            class="header-scan-btn"
            @click="openScannerModal"
          >
            {{ t('header.scanClient') }}
          </VaButton>
          <div class="header-clock">
            <span class="header-clock__date">{{ clockDate }}</span
            ><span class="header-clock__sep">, </span
            ><span class="header-clock__time">{{ clockTime }}</span>
          </div>
        </div>
      </template>
    </VaNavbar>

    <VaModal
      v-model="scannerOpen"
      hide-default-actions
      no-padding
      no-outside-dismiss
      max-width="min(92vw, 560px)"
    >
      <div ref="scannerModalRef" class="scanner-modal scanner-modal--sheet">
        <header class="scanner-modal__header scanner-modal__header--hero">
          <div class="scanner-modal__hero">
            <div class="scanner-modal__hero-icon" aria-hidden="true">
              <VaIcon name="qr_code_scanner" size="26px" />
            </div>
            <div class="scanner-modal__title-wrap">
              <h3 class="scanner-modal__title">{{ t('header.scannerTitle') }}</h3>
              <p class="scanner-modal__subtitle">{{ t('header.scannerSubtitle') }}</p>
            </div>
          </div>
          <VaButton
            icon="close"
            size="small"
            preset="plain"
            color="secondary"
            class="scanner-modal__close-fab"
            :aria-label="t('header.closeScanner')"
            @click="closeScannerModal"
          />
        </header>

        <form class="scanner-modal__body" @submit.prevent="onScannerSubmit">
          <div
            class="scanner-modal__code-wrap"
            :class="{ 'scanner-modal__code-wrap--not-found': scannerHintTone === 'notFound' }"
          >
            <VaInput
              v-model="scannerInputValue"
              :label="t('header.scannerInputLabel')"
              autocomplete="off"
              autofocus
              :disabled="scannerLoading"
              @keydown.enter.prevent="onScannerSubmit"
              @update:model-value="onScannerCodeInput"
            />
          </div>
          <div
            v-if="scannerClientCard"
            class="scanner-client-card"
            :class="{
              'scanner-client-card--entry-blocked': scannerClientEntryNotAllowed,
              'scanner-client-card--in-gym':
                scannerClientInGym && !scannerClientEntryNotAllowed,
            }"
            role="group"
          >
            <div
              v-if="scannerClientEntryNotAllowed"
              class="scanner-client-card__alert"
              role="status"
            >
              {{
                scannerClientCard?.status === 'BLOCKED'
                  ? t('header.scannerBlockedClientBanner')
                  : t('header.scannerInactiveClientBanner')
              }}
            </div>
            <div class="scanner-client-card__name-row">
              <div class="scanner-client-card__name">{{ scannerClientCard.fullName }}</div>
              <VaButton
                type="button"
                preset="secondary"
                size="small"
                icon="open_in_new"
                class="scanner-client-card__open-profile"
                @click.stop="goToClientProfile"
              >
                {{ t('header.openClientProfile') }}
              </VaButton>
            </div>
            <div class="scanner-client-card__meta">
              <span>{{ scannerClientCard.phone }}</span>
              <span>•</span>
              <span
                class="scanner-client-card__status"
                :class="{ 'scanner-client-card__status--danger': scannerClientEntryNotAllowed }"
                >{{ t(`clients.status.${scannerClientCard.status}`) }}</span
              >
            </div>
            <div class="scanner-client-card__state" :class="{ 'scanner-client-card__state--in': scannerClientInGym }">
              {{
                scannerClientInGym
                  ? scannerVisitStatus === 'OVERDUE'
                    ? t('header.scannerOverdueWithLocker', { locker: scannerCurrentLocker || '—' })
                    : t('header.scannerInGymWithLocker', { locker: scannerCurrentLocker || '—' })
                  : t('header.scannerNotInGymLabel')
              }}
            </div>
            <VaInput
              v-if="!scannerClientInGym && !scannerClientEntryNotAllowed"
              v-model="scannerLockerNumber"
              class="scanner-modal__locker-field"
              :label="t('header.scannerLockerLabel')"
              :disabled="scannerLoading"
            />
          </div>
          <div
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
              size="22px"
            />
            <VaIcon
              v-else-if="scannerHintTone === 'error'"
              name="error_outline"
              color="#b91c1c"
              class="scanner-modal__hint-icon"
              size="22px"
            />
            <VaIcon
              v-else-if="scannerHintTone === 'callout'"
              name="pin_drop"
              class="scanner-modal__hint-icon scanner-modal__hint-icon--callout"
              size="22px"
            />
            <span class="scanner-modal__hint-text">{{ scannerHint ?? t('header.scannerHint') }}</span>
          </div>
          <div v-if="scannerClientCard" class="scanner-modal__another">
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
          <div class="scanner-modal__actions">
            <VaButton
              v-if="!scannerClientCard"
              type="submit"
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
              icon="person_add"
              preset="secondary"
              class="scanner-modal__action-span"
              @click="startCreateClientFromUnknownCard"
            >
              {{ t('header.scannerCreateClientButton') }}
            </VaButton>
            <VaButton
              v-if="scannerClientCard && !scannerClientInGym && !scannerClientEntryNotAllowed"
              type="button"
              icon="login"
              color="success"
              class="scanner-modal__action-span"
              :loading="scannerLoading"
              @click="scannerCheckIn"
            >
              {{ t('header.scannerCheckIn') }}
            </VaButton>
            <template v-if="scannerClientCard && scannerClientInGym">
              <VaButton
                type="button"
                color="warning"
                icon="logout"
                class="scanner-modal__action-split"
                :loading="scannerLoading"
                @click="scannerCheckOut"
              >
                {{ t('header.scannerCheckOut') }}
              </VaButton>
              <VaButton
                type="button"
                color="danger"
                icon="lock_reset"
                class="scanner-modal__action-split"
                :loading="scannerLoading"
                @click="scannerForceClose('LOST_KEY')"
              >
                {{ t('header.scannerForceClose') }}
              </VaButton>
            </template>
          </div>
        </form>
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
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

.logo-placeholder {
  flex-shrink: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--app-muted);
}

.brand-title {
  color: var(--app-text);
  text-decoration: none;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-title:hover {
  text-decoration: underline;
  text-decoration-color: var(--app-accent);
}

.header-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  justify-content: flex-end;
}

.header-scan-btn {
  --va-button-sm-height: 2rem;
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
}

.header-clock__time {
  font-weight: 600;
}

.scanner-modal {
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 600px);
}

.scanner-modal--sheet {
  border-radius: 18px;
  overflow: hidden;
  background: var(--app-surface);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1);
}

.scanner-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1rem 1rem 0.75rem;
  border-bottom: 1px solid var(--app-border);
}

.scanner-modal__header--hero {
  border-bottom: none;
  padding: 1.1rem 1.15rem 1rem;
  background: linear-gradient(
    125deg,
    color-mix(in srgb, var(--va-primary) 14%, transparent) 0%,
    color-mix(in srgb, var(--va-primary) 4%, transparent) 55%,
    var(--app-surface) 100%
  );
}

.scanner-modal__hero {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  min-width: 0;
  flex: 1;
  padding-right: 0.25rem;
}

.scanner-modal__hero-icon {
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--va-primary) 20%, var(--app-surface));
  color: var(--va-primary);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--va-primary) 25%, transparent);
}

.scanner-modal__close-fab {
  flex-shrink: 0;
  margin-top: -0.1rem;
}

.scanner-modal__title-wrap {
  min-width: 0;
}

.scanner-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--app-text);
}

.scanner-modal__subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--app-muted);
}

.scanner-modal__body {
  padding: 1rem 1.15rem 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
  background: linear-gradient(180deg, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 96%, var(--app-muted) 4%) 100%);
}

.scanner-modal__body :deep(.va-input-wrapper) {
  width: 100%;
  display: block;
}

.scanner-modal__code-wrap {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  transition:
    box-shadow 0.15s ease,
    background-color 0.15s ease;
}

.scanner-modal__code-wrap--not-found {
  padding: 0.65rem 0.75rem 0.55rem;
  background: rgba(220, 38, 38, 0.08);
  box-shadow: 0 0 0 2px #dc2626;
}

/* Одна рамка снаружи: убираем стандартную обводку VaInput (фиолетовый контур). */
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

.scanner-modal__hint {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.83rem;
  color: var(--app-muted);
  min-height: 1.1rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.scanner-modal__hint-text {
  flex: 1;
  min-width: 0;
  line-height: 1.45;
}

.scanner-modal__hint-icon {
  flex-shrink: 0;
  margin-top: 0.05rem;
}

.scanner-modal__hint--not-found {
  color: #991b1b;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.12);
  border: 1px solid rgba(220, 38, 38, 0.45);
}

.scanner-modal__hint--error {
  color: #991b1b;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.38);
}

/* Светлый текст на более насыщенном фоне — читаемо на тёмной теме (раньше #9a3412 на жёлтой прозрачности почти сливался). */
.scanner-modal__hint--callout {
  color: #fffbeb;
  font-weight: 700;
  font-size: 0.94rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #c2410c 52%, var(--app-surface)) 0%,
    color-mix(in srgb, #9a3412 48%, var(--app-surface)) 100%
  );
  border: 1px solid rgba(251, 191, 36, 0.42);
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.28);
}

.scanner-modal__hint--callout .scanner-modal__hint-text {
  font-weight: 700;
  letter-spacing: 0.01em;
  color: inherit;
}

.scanner-modal__hint-icon--callout {
  color: #fde047;
}

.scanner-client-card {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 0.9rem 0.85rem;
  display: grid;
  gap: 0.5rem;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
  background: var(--app-surface);
}

.scanner-client-card--in-gym {
  border-color: color-mix(in srgb, var(--va-success) 35%, var(--app-border));
  border-left-width: 4px;
  border-left-color: var(--va-success);
  box-shadow: 0 6px 22px rgba(22, 101, 52, 0.1);
}

.scanner-client-card--entry-blocked {
  border: 2px solid #dc2626;
  background: rgba(220, 38, 38, 0.07);
  box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.2);
}

/* Светлый текст на насыщенном фоне — тёмно-красный (#991b1b) на rgba(..., 0.16) на тёмной карте не читался. */
.scanner-client-card__alert {
  margin: -0.15rem -0.35rem 0.15rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.35;
  color: #fff5f5;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #b91c1c 58%, var(--app-surface)) 0%,
    color-mix(in srgb, #991b1b 52%, var(--app-surface)) 100%
  );
  border: 1px solid rgba(248, 113, 113, 0.45);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.22);
}

.scanner-client-card__name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
}

.scanner-client-card__name {
  flex: 1;
  min-width: 0;
  font-size: 1rem;
  font-weight: 700;
}

.scanner-client-card__open-profile {
  flex-shrink: 0;
}

.scanner-client-card__meta {
  font-size: 0.82rem;
  color: var(--app-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.scanner-client-card__status--danger {
  color: #b91c1c;
  font-weight: 700;
}

.scanner-client-card__state {
  font-size: 0.85rem;
  font-weight: 600;
  color: #fb923c;
}

.scanner-client-card__state--in {
  color: #166534;
}

.scanner-modal__another {
  width: 100%;
  display: flex;
  justify-content: flex-start;
  padding-top: 0.1rem;
}

.scanner-modal__another-btn {
  font-weight: 600;
}

.scanner-modal__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  gap: 0.55rem;
  align-items: stretch;
  padding-top: 0.15rem;
}

.scanner-modal__action-span {
  grid-column: 1 / -1;
}

.scanner-modal__action-split {
  min-width: 0;
}

.scanner-modal__actions :deep(.va-button) {
  width: 100%;
  justify-content: center;
}

@media (max-width: 440px) {
  .scanner-modal__actions {
    grid-template-columns: 1fr;
  }

  .scanner-modal__action-split {
    grid-column: 1 / -1;
  }
}
</style>
