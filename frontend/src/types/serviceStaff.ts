export type ServiceStaffStatus = 'ACTIVE' | 'INACTIVE'

export type ServiceStaffRow = {
  id: string
  firstName: string
  lastName: string
  middleName?: string | null
  fullName: string
  position?: string | null
  phone?: string | null
  cardNumber: string
  accessKey?: string | null
  status: ServiceStaffStatus
  photoUrl?: string | null
  notes?: string | null
  inGym?: boolean
  openVisitStatus?: string | null
  visitEnteredAt?: string | null
  visitExitedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ServiceStaffForm = {
  firstName: string
  lastName: string
  middleName: string
  position: string
  phone: string
  cardNumber: string
  accessKey: string
  status: ServiceStaffStatus
  notes: string
}

export type StaffVisitRow = {
  id: string
  enteredAt: string
  exitedAt?: string | null
  status: string
  closeReason?: string | null
  comment?: string | null
  enteredBy?: { firstName?: string | null; lastName?: string | null; login?: string | null } | null
  exitedBy?: { firstName?: string | null; lastName?: string | null; login?: string | null } | null
}
