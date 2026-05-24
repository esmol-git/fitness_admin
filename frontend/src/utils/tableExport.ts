import * as XLSX from 'xlsx-js-style'

export type TableExportFormat = 'csv' | 'xlsx'

export function escapeCsvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const TITLE_ROW_STYLE = {
  font: { bold: true, sz: 12 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
} as const

function applyMergedTitleRows(sheet: XLSX.WorkSheet, preambleCount: number, columnCount: number) {
  if (preambleCount <= 0 || columnCount <= 0) return

  const merges: XLSX.Range[] = []
  const rows: XLSX.RowInfo[] = []

  for (let row = 0; row < preambleCount; row += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: 0 })
    const cell = sheet[cellRef]
    if (!cell) continue

    cell.s = TITLE_ROW_STYLE
    if (columnCount > 1) {
      merges.push({
        s: { r: row, c: 0 },
        e: { r: row, c: columnCount - 1 },
      })
    }
    rows[row] = { hpt: 22 }
  }

  if (merges.length) {
    sheet['!merges'] = [...(sheet['!merges'] ?? []), ...merges]
  }
  if (rows.length) {
    sheet['!rows'] = rows
  }
}

export function downloadTableExport(options: {
  format: TableExportFormat
  filenameBase: string
  headers: string[]
  rows: string[][]
  /** Строки над заголовками таблицы (например, период выгрузки) */
  preamble?: string[]
  /** CSV: «;» удобнее для Excel в ru-RU */
  csvDelimiter?: ';' | ','
}) {
  const date = new Date().toISOString().slice(0, 10)
  const { format, filenameBase, headers, rows } = options
  const preambleLines = (options.preamble ?? []).filter(Boolean)
  const columnCount = Math.max(headers.length, 1)
  const preambleRows = preambleLines.map((line) => [line])
  const tableRows = [headers, ...rows]

  if (format === 'csv') {
    const delim = options.csvDelimiter ?? ';'
    const csvPreambleRows = preambleLines.map((line) => {
      const row = Array(columnCount).fill('')
      row[0] = line
      return row
    })
    const csv = [...csvPreambleRows, ...tableRows]
      .map((line) => line.map((cell) => escapeCsvCell(cell)).join(delim))
      .join('\n')
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
    downloadBlob(blob, `${filenameBase}-${date}.csv`)
    return
  }

  const sheet = XLSX.utils.aoa_to_sheet([...preambleRows, ...tableRows])
  applyMergedTitleRows(sheet, preambleRows.length, columnCount)

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Export')
  XLSX.writeFile(book, `${filenameBase}-${date}.xlsx`, { cellStyles: true })
}
