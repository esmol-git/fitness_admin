export type UserRole =
  | 'ADMIN'
  | 'MANAGER'
  | 'TRAINER'
  | 'RECEPTIONIST'
  | 'TRAINEE'

export type UserRow = {
  id: string
  login: string
  email: string | null
  firstName: string | null
  lastName: string | null
  birthDate: string | null
  position: string | null
  role: UserRole
  phone: string | null
  salary: number | null
  isEmployee: boolean
  createdAt: string
}

export type UserForm = {
  firstName: string
  lastName: string
  birthDate: string
  login: string
  email: string
  password: string
  passwordConfirm: string
  role: UserRole
  phone: string
}
