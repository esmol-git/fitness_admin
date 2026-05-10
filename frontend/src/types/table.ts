export type TableSortOrder = 'asc' | 'desc' | null

export interface TableHeaderConfig<Key extends string = string> {
  key: Key
  label: string
  sortable?: boolean
  width?: string
  thAlign?: 'left' | 'center' | 'right'
  tdAlign?: 'left' | 'center' | 'right'
}
