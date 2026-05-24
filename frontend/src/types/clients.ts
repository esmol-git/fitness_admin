export type ClientStatus = 'ACTIVE' | 'PAUSED' | 'INACTIVE' | 'BLOCKED'
export type ClientGender = 'MALE' | 'FEMALE'

export interface ClientRow {
  id: string
  name: string
  firstName: string
  lastName: string
  middleName: string | null
  phone: string
  email: string | null
  status: ClientStatus
  gender: ClientGender | null
  birthDate: string | null
  managerId: string | null
  managerName?: string | null
  membershipType: string | null
  /** Название позиции справочника абонементов (в т.ч. для неактивных), подставляется в GET /clients */
  membershipCatalogName?: string | null
  contractNumber: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  /** Список GET /clients: даты из активного/на паузе ContractDocument, если заполнены */
  effectiveContractStartDate?: string | null
  effectiveContractEndDate?: string | null
  paymentDate: string | null
  passport: string | null
  passportIssuedBy: string | null
  passportIssuedAt: string | null
  address: string | null
  notes: string | null
  cardNumber: string | null
  lockerNumber: string | null
  accessKey: string | null
  photoUrl: string | null
  inGym?: boolean
  /** Незакрытая сессия визита (exitedAt=null): IN_GYM или OVERDUE и т.д. */
  openVisitStatus?: 'IN_GYM' | 'OVERDUE' | 'LEFT' | 'FORCE_CLOSED' | null
  lastVisitAt?: string | null
  createdAt: string
}

export interface ClientForm {
  firstName: string
  lastName: string
  phone: string
  middleName: string
  birthDate: string
  gender: ClientGender | ''
  status: ClientStatus
  email: string
  passport: string
  passportIssuedBy: string
  passportIssuedAt: string
  address: string
  notes: string
  contractNumber: string
  contractStartDate: string
  contractEndDate: string
  paymentDate: string
  membershipType: string
  cardNumber: string
  lockerNumber: string
  photoUrl: string
}
