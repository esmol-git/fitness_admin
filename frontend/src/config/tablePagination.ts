/** Допустимые значения limit в списках и в query URL — один источник правды */
export const TABLE_PAGE_SIZES = [10, 25, 50, 100] as const

export type TablePageSizeOption = (typeof TABLE_PAGE_SIZES)[number]

export const DEFAULT_TABLE_PAGE_LIMIT: TablePageSizeOption = 10

/** Блок «на странице» + пагинация показывается, если записей больше этого числа */
export const TABLE_PAGER_MIN_TOTAL_ITEMS = DEFAULT_TABLE_PAGE_LIMIT
