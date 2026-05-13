import { defineStore } from 'pinia'

export type UiPendingNotice = 'forbidden' | 'network'

export const useUiStore = defineStore('ui', {
  state: () => ({
    pendingNotice: null as UiPendingNotice | null,
    scannerTargetClientId: null as string | null,
    /** Incremented when scanner modal closes so ClientsView can reload the table. */
    clientsTableRefreshTick: 0,
    /** После входа/выхода/force-close из сканера — VisitsView перезагружает список. */
    visitsTableRefreshTick: 0,
    /** После записи платежа из карточки клиента / сохранения договора — PaymentsView перезагружает реестр. */
    paymentsTableRefreshTick: 0,
    /** Открыть модалку сканера и выполнить lookup по карте/ключу (с ClientsView и др.). */
    scannerLookupTick: 0,
    scannerLookupCode: '',
    /** Префилл номера карты при открытии создания клиента из сканера («не найден»). */
    createClientPrefillCardNumber: '',
    createClientFromScannerTick: 0,
    /** Мобильное меню (бургер): выезд сайдбара ≤960px. На десктопе не используется. */
    mobileSidebarOpen: false,
  }),
  actions: {
    setPendingNotice(kind: UiPendingNotice) {
      this.pendingNotice = kind
    },
    clearPendingNotice() {
      this.pendingNotice = null
    },
    setScannerTargetClientId(id: string | null) {
      this.scannerTargetClientId = id
    },
    requestScannerLookup(code: string) {
      this.scannerLookupCode = code.trim()
      this.scannerLookupTick += 1
    },
    requestCreateClientFromScanner(cardNumber: string) {
      const next = cardNumber.trim()
      if (!next) return
      this.createClientPrefillCardNumber = next
      this.createClientFromScannerTick += 1
    },
    bumpClientsTableRefresh() {
      this.clientsTableRefreshTick += 1
    },
    bumpVisitsTableRefresh() {
      this.visitsTableRefreshTick += 1
    },
    bumpPaymentsTableRefresh() {
      this.paymentsTableRefreshTick += 1
    },
    toggleMobileSidebar() {
      this.mobileSidebarOpen = !this.mobileSidebarOpen
    },
    closeMobileSidebar() {
      this.mobileSidebarOpen = false
    },
  },
})
