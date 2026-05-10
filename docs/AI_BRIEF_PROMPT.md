# Промпт для AI (Copilot / ChatGPT): админ-панель фитнес-центра

Скопируй блок ниже целиком при генерации кода, документации или ревью. Актуальный пошаговый план разработки: [ADMIN_PANEL_DEVELOPMENT_PLAN.md](ADMIN_PANEL_DEVELOPMENT_PLAN.md). Схема БД: [prisma-target-schema.prisma](prisma-target-schema.prisma).

---

```
Ты — senior fullstack-разработчик (Vue 3 + NestJS). Генерируй или анализируй код админ-панели фитнес-центра со следующими требованиями.

## Стек
- Frontend: Vue 3, Vite, TypeScript, Pinia (+ pinia-plugin-persistedstate), Vue Router, Vuestic UI, vue-i18n (RU/EN), VeeValidate + Zod, ApexCharts (vue3-apexcharts), @vueuse/core, GSAP, @zxing/library для QR; markdown для заметок с санитизацией (DOMPurify).
- Backend: NestJS, Prisma, PostgreSQL, JWT access+refresh, bcrypt, class-validator/class-transformer, @nestjs/swagger, @nestjs/throttler, @nestjs/cache-manager + Redis (ioredis), nest-winston; опционально @nestjs/i18n для текстов ошибок.
- Деплой (цель): один VPS, Docker Compose (Postgres + Redis), Nginx (статика SPA + proxy /api → Nest), PM2 для Node.

## RBAC (Prisma enum Role)
ADMIN — полный доступ, роли сотрудников, финансы, отчёты, настройки.
MANAGER — операции: клиенты, абонементы, платежи, расписания, отчёты; сотрудники без смены role.
TRAINER — свои классы/расписание, клиенты из связи ClientTrainer, посещения своих групп, просмотр абонементов этих клиентов.
RECEPTIONIST — чек-ин/аут, поиск клиентов, чтение абонементов/платежей, базовые отчёты посещений.
TRAINEE (опционально) — только свой профиль, абонемент, расписание, self check-in.

Guards: JwtAuthGuard + RolesGuard + @Roles(...). На фронте — фильтрация меню по role (только UX).

## Модули
Dashboard (KPI, графики, фильтры дат), Users/Employees, Clients, Memberships, Schedules/GymClass + Booking, Attendance, Payments, Reports (CSV/PDF), Settings (центр, уведомления, бэкапы, дефолты темы/языка).

## Мультиязычность и темы
- vue-i18n: ключи вроде dashboard.kpi.active; переключатель в header.
- Vuestic: light/dark + 5 пресетов акцента (blue, green, orange, purple, red) через CSS variables; дефолты в модели ThemeSettings (defaultPreset, defaultLocale), пользователь — localStorage + опционально API.

## API
REST, префикс /api, пагинация ?page=&limit=&search=, типобезопасные DTO, OpenAPI.

## Безопасность
ValidationPipe, rate limit на /auth/login, HTTPS, не логировать пароли, не доверять role с клиента.

## Ожидаемый вывод при запросе «сгенерируй»
Указывай файлы и пути; полный типобезопасный код; учитывай инвалидацию кэша при мутациях; следуй best practices из плана проекта.
```

---

Примечания для человека:

- Пакет для Redis с `cache-manager` уточняй по версии NestJS в официальной документации (`@keyv/redis` или совместимый store).
- Версии `vuestic-ui` и API тем смотри на [vuestic.dev](https://vuestic.dev).
