# Backend Role Access Matrix

Last updated: 2026-04-30

## Legend

- Public: endpoint is available without JWT.
- Authenticated: endpoint requires valid JWT, but no explicit `@Roles(...)` restriction.
- Roles: endpoint requires JWT and one of listed roles.

## Public Endpoints

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api` | Public |
| GET | `/api/health/live` | Public |
| GET | `/api/health/ready` | Public |
| POST | `/api/auth/login` | Public (throttled) |
| POST | `/api/auth/refresh` | Public (throttled) |
| POST | `/api/auth/logout` | Public (throttled) |

## Authenticated (No Role Restriction)

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/auth/me` | Authenticated |
| GET | `/api/settings/me` | Authenticated |
| PATCH | `/api/settings/me` | Authenticated |

## Role Restricted Endpoints

### Auth

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/auth/admin/ping` | `ADMIN` |

### Users

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/users` | `ADMIN`, `MANAGER` |
| POST | `/api/users` | `ADMIN`, `MANAGER` |
| PATCH | `/api/users/:id` | `ADMIN`, `MANAGER` |
| DELETE | `/api/users/:id` | `ADMIN` |

### Clients

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/clients` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/clients/lookup` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/clients/validate-card` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/clients/address-suggestions` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/clients/:id` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| POST | `/api/clients` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/clients/:id` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/clients/:id/block` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/clients/:id/unblock` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| DELETE | `/api/clients/:id` | `ADMIN`, `MANAGER` |

### Contracts

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/contracts/template-fields` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/contracts` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| POST | `/api/contracts/sync-statuses` | `ADMIN`, `MANAGER` |
| POST | `/api/contracts/render-html` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/contracts/generate` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| GET | `/api/contracts/client/:clientId` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/contracts/client/:clientId/can-generate` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/contracts/client/:clientId/generate` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/contracts/client/:clientId/:contractId/generate` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/contracts/client/:clientId/save` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/contracts/:contractId/status` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/contracts/:contractId/pause` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/contracts/:contractId/resume` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/contracts/:contractId/terminate` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/contracts/:contractId/cancel-with-refund` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| DELETE | `/api/contracts/:contractId` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| GET | `/api/contracts/:contractId/open-url` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |

### Payments

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/api/payments` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| GET | `/api/payments` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/payments/client/:clientId` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| DELETE | `/api/payments/:id` | `ADMIN`, `MANAGER`, `RECEPTIONIST` (currently blocked by service policy) |

### Visits

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/visits/lookup` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/visits/current` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| GET | `/api/visits` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| POST | `/api/visits/check-in` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/visits/check-out` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| POST | `/api/visits/force-close` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |

### Membership Catalog

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/membership-catalog` | `ADMIN`, `MANAGER`, `RECEPTIONIST`, `TRAINER` |
| POST | `/api/membership-catalog` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| PATCH | `/api/membership-catalog/:id` | `ADMIN`, `MANAGER`, `RECEPTIONIST` |
| DELETE | `/api/membership-catalog/:id` | `ADMIN`, `MANAGER` |

### Dashboard / Reports

| Method | Path | Roles |
| --- | --- | --- |
| GET | `/api/dashboard/summary` | `ADMIN`, `MANAGER` |
| GET | `/api/dashboard/charts` | `ADMIN`, `MANAGER` |
| GET | `/api/dashboard/alerts` | `ADMIN`, `MANAGER` |
| GET | `/api/reports/overview` | `ADMIN`, `MANAGER` |

## Follow-up Checklist

- If a new controller method is added, update this file in the same PR.
- If an endpoint is intentionally public, explicitly document why.
- Keep frontend menu visibility in sync with this matrix.
