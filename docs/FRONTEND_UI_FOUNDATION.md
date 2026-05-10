# Frontend UI Foundation

## Purpose

This document defines stable frontend UI conventions for the admin panel.
Every new screen should reuse existing building blocks and tokens instead of adding isolated styles.

## Core principles

- Component-first architecture for all page sections.
- Theme tokens first, local CSS second.
- Common UX patterns for loading, empty, error, and success states.
- Reusable controls for filter bars, forms, tables, and confirmations.

## Visual tokens

Use tokens from `frontend/src/assets/main.css` as the source of truth:

- Accent and semantic: `--app-accent`, `--app-accent-soft`, `--app-accent-strong`
- Surface and text: `--app-surface`, `--app-text`, `--app-muted`
- Borders and elevation: `--app-border`, `--app-shadow-soft`, `--app-shadow-card`
- Radius scale: `--app-radius-sm`, `--app-radius-md`, `--app-radius-lg`

List pagination defaults (`TABLE_PAGE_SIZES`, `DEFAULT_TABLE_PAGE_LIMIT`) live in `frontend/src/config/tablePagination.ts` and are shared by `AppTablePageSize` and `use*ListUrlSync`.

## Reusable component layers

- Layout shell: header, sidebar, content frame
- Page frame: `AppPageCard`
- Section blocks: `AppSectionCard`
- List toolbars: `AppPageCard` actions + `AppFilterBar` (filters + reset); optional dedicated search row: `AppToolbar`
- Filter controls: `AppFilterBar`
- Tables: `AppDataTableShell` + feature table component; list footer: `AppTablePagerRow` (wraps `AppTablePageSize` + `AppTablePagination`)
- Empty state: `AppEmptyState`
- Modals: `ConfirmModal` + form sections

## Reusable composables

- `useTableState<T>`: page, limit (default `DEFAULT_TABLE_PAGE_LIMIT` from `tablePagination.ts`), debounced search, optional filters/sort, loading, error
- `useTableDataSource()`: generic query watcher with pluggable API or mock fetcher
- `useTableSortingSync()`: sync sort select, table header sorting, and default reset
- `useUsersListUrlSync()` / `useClientsListUrlSync()`: sync list state with URL query (`q`, filters, `page`, `limit`, `sort`)
- `useCrudForm<T>`: modal open/close, loading, error and typed form state
- `resolveApiErrorMessage()`: endpoint error mapping by HTTP status

## Form validation (canonical)

**Use Vuelidate** (`@vuelidate/core`, `@vuelidate/validators`) with Vue 3 Composition API and `useVuelidate(rules, state, { $autoDirty: true })`.

**Do not** combine the same fields with Vuestic’s built-in form validation (`VaForm` + `:rules` on `VaInput` / `VaSelect` / etc.). That is a second validation layer: duplicate messages and different show/hide timing.

**Vuestic quirk:** `VaInput` (and other inputs using `useValidation`) only forwards `error` / `error-messages` to `VaInputWrapper` when internal `computedError` is true. By default that requires blur or model change. After a submit attempt, bind **`:immediate-validation="submitAttempted"`** (or equivalent) so server-side / submit-time errors and messages stay in sync.

**Login reference:** `frontend/src/views/LoginView.vue` — `submitAttempted`, `await v$.value.$validate()`, helpers `showFieldError` / `fieldErrorMessage` using `$invalid` after submit and `$silentErrors` fallback for messages, `:error`, `:error-messages`, `:immediate-validation="submitAttempted"`, native `<form @submit.prevent>`, submit control `type="submit"`.

**Users modals:** `UsersView` + `UserFormFields` — Vuelidate rules in `userFormVuelidateRules.ts`, `submitAttempted` per modal, `immediate-validation` on inputs.

## Routing and app shell

- **`main.ts`:** call `await router.isReady()` before `app.mount()` so the first paint matches the resolved route (avoids a flash of sidebar before redirect to login).
- **Guards:** `requiresAuth`, `guestOnly`, optional `roles` — see `frontend/src/router/index.ts`.
- **404:** catch-all route `/:pathMatch(.*)*` with `requiresAuth: true` (guests → login; logged-in users see `NotFoundView`).
- **Minimal chrome:** set `meta.standaloneLayout: true` for full-width centered pages without sidebar (same shell as login: compact header + `main--minimal`). Typed in `frontend/env.d.ts` (`RouteMeta`).

## UX behavior contract

- List screens use one state machine: **loading skeleton -> empty state -> data table**.
- Use `AppDataTableShell` with `loading`, `hasItems`, `showPager` and slots `skeleton` / `empty` / default.
- On query/filter/page route transitions, prefer skeleton over spinner for visual continuity.
- Any list page must support: loading state, empty state, and error state.
- Filters and pagination are rendered in one consistent location.
- Destructive actions are always confirmed with a dedicated modal.
- Submit buttons show loading and are disabled during request.

## Frontend-only module strategy

When backend contracts are not finalized:

1. Build module UI with typed mock data.
2. Keep all list/filter/pagination state in composables or page stores.
3. Replace mock provider with API provider later without rewriting UI components.
