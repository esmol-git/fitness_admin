/**
 * Единые имена Material Icons для действий в строках таблиц (VaButton / VaIcon).
 * Использовать везде, чтобы иконки одного смысла не расходились между страницами.
 */
export const TableActionIcon = {
  edit: 'edit',
  delete: 'delete',
  /** Блокировка клиента (доступ в зал) */
  blockClient: 'lock',
  /** Разблокировка клиента */
  unblockClient: 'lock_open',
  /** Открыть файл/URL в новой вкладке (PDF в S3 и т.п.) */
  openExternal: 'open_in_new',
  /** Связанный договор / документ (платёж → договор, превью) */
  viewDocument: 'description',
  /** Сгенерировать договор (список клиентов) */
  generateContract: 'post_add',
  /** Заморозка договора */
  contractPause: 'ac_unit',
  /** Разморозка договора */
  contractResume: 'play_circle',
  /** Запуск ожидающего договора (дата начала услуги) */
  contractActivate: 'play_arrow',
  /** Расторжение / отмена договора (не путать с blockClient) */
  contractTerminate: 'cancel',
} as const

export type TableActionIconKey = keyof typeof TableActionIcon
