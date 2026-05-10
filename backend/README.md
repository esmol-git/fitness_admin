# Backend

NestJS + Prisma 6 + PostgreSQL.

- Скопируй `.env.example` → `.env`, подними БД (`docker compose up -d` из корня репозитория).
- Первая миграция: `npx prisma migrate deploy` (или `prisma migrate dev` при разработке схемы).
- Запуск: `npm run start:dev`
- Сид (админ): `npx prisma db seed` → `admin@fitness.local` / `Admin123!`

**Auth (JWT):** `POST /api/auth/login`, `GET /api/auth/me` (Bearer), `GET /api/auth/admin/ping` (только `ADMIN`).

Схема БД: `prisma/schema.prisma` (синхронизирована с `docs/prisma-target-schema.prisma`).
