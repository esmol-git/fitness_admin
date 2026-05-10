import { describe, expect, it } from 'vitest'
import { buildClientsListRouteQuery, parseClientsListRouteQuery } from '@/composables/useClientsListUrlSync'
import { parseUsersListRouteQuery } from '@/composables/useUsersListUrlSync'
import { routeQueryEquals } from '@/composables/tableListUrlQueryUtils'
import { DEFAULT_TABLE_PAGE_LIMIT } from '@/config/tablePagination'
import { USERS_ROLE_FILTER_ALL } from '@/config/usersTable'

describe('parseUsersListRouteQuery', () => {
  it('uses defaults for empty query', () => {
    const p = parseUsersListRouteQuery({})
    expect(p).toMatchObject({
      search: '',
      role: USERS_ROLE_FILTER_ALL,
      page: 1,
      limit: DEFAULT_TABLE_PAGE_LIMIT,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
  })

  it('parses q, role, page, limit, sort', () => {
    const p = parseUsersListRouteQuery({
      q: 'test',
      role: 'ADMIN',
      page: '2',
      limit: '25',
      sort: 'email:asc',
    })
    expect(p.search).toBe('test')
    expect(p.role).toBe('ADMIN')
    expect(p.page).toBe(2)
    expect(p.limit).toBe(25)
    expect(p.sortBy).toBe('email')
    expect(p.sortOrder).toBe('asc')
  })
})

describe('parseClientsListRouteQuery', () => {
  it('uses defaults for empty query', () => {
    const p = parseClientsListRouteQuery({})
    expect(p).toMatchObject({
      search: '',
      status: '',
      page: 1,
      limit: DEFAULT_TABLE_PAGE_LIMIT,
      sortBy: 'fullName',
      sortOrder: 'asc',
    })
  })

  it('parses status and sort', () => {
    const p = parseClientsListRouteQuery({
      q: 'иван',
      status: 'PAUSED',
      sort: 'createdAt:desc',
      page: '3',
      limit: '50',
    })
    expect(p.search).toBe('иван')
    expect(p.status).toBe('PAUSED')
    expect(p.sortBy).toBe('createdAt')
    expect(p.sortOrder).toBe('desc')
    expect(p.page).toBe(3)
    expect(p.limit).toBe(50)
  })

  it('ignores invalid sort', () => {
    const p = parseClientsListRouteQuery({ sort: 'phone:asc' })
    expect(p.sortBy).toBe('fullName')
    expect(p.sortOrder).toBe('asc')
  })
})

describe('buildClientsListRouteQuery', () => {
  it('omits default state', () => {
    expect(
      buildClientsListRouteQuery({
        search: '',
        status: '',
        inGym: '',
        membershipType: '',
        lastVisitFrom: '',
        lastVisitTo: '',
        gender: '',
        ageFrom: '',
        ageTo: '',
        page: 1,
        limit: DEFAULT_TABLE_PAGE_LIMIT,
        sortBy: 'fullName',
        sortOrder: 'asc',
      }),
    ).toEqual({})
  })

  it('includes non-default sort and status', () => {
    const q = buildClientsListRouteQuery({
      search: '',
      status: 'ACTIVE',
      inGym: '',
      membershipType: '',
      lastVisitFrom: '',
      lastVisitTo: '',
      gender: '',
      ageFrom: '',
      ageTo: '',
      page: 1,
      limit: DEFAULT_TABLE_PAGE_LIMIT,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
    expect(q.status).toBe('ACTIVE')
    expect(q.sort).toBe('createdAt:desc')
  })
})

describe('routeQueryEquals', () => {
  it('treats missing keys as empty string', () => {
    expect(routeQueryEquals({ a: '1' }, { a: '1' })).toBe(true)
    expect(routeQueryEquals({ a: '1' }, {})).toBe(false)
    expect(routeQueryEquals({}, { b: [''] })).toBe(true)
  })
})
