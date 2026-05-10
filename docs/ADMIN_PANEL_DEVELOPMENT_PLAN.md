# План разработки админ-панели фитнес-центра

Подробная пошаговая инструкция с разделением на бэкенд и фронтенд. В каждом шаге указано **зачем** это делается и **как** примерно реализовать. Предполагается локальная разработка (PostgreSQL и Redis через Docker или локально), Git для версионности. **Время на шаг** — ориентир для одного разработчика.

**Связанные файлы:** целевая Prisma-схема с RBAC — [prisma-target-schema.prisma](prisma-target-schema.prisma); готовый текст промпта для AI — [AI_BRIEF_PROMPT.md](AI_BRIEF_PROMPT.md).

---

## 0. Спецификация продукта, RBAC и модули

### 0.1. Общая цель

Веб-приложение для управления фитнес-центром: **клиенты**, **абонементы**, **расписания**, **посещения**, **платежи**, **отчёты**. **RBAC** (роли в Prisma `enum`), **REST API**, **JWT** (желательно access + refresh). UI: адаптивный, боковое меню с пунктами по правам.

### 0.2. Роли (`enum Role` в Prisma)

| Роль | Смысл | Доступ (кратко) |
|------|--------|------------------|
| **ADMIN** | Владелец / суперпользователь | Полный CRUD, роли сотрудников, финансы, отчёты, настройки |
| **MANAGER** | Операционный менеджер | Клиенты, абонементы, платежи, расписания, отчёты; сотрудники без смены ролей |
| **TRAINER** | Тренер | Свои классы/расписание, «свои» клиенты (связь назначения — отдельная таблица при необходимости), посещения своих групп, просмотр абонементов этих клиентов |
| **RECEPTIONIST** | Ресепшн | Чек-ин/аут, поиск клиентов, чтение абонементов/платежей, базовые отчёты посещений |
| **TRAINEE** | Клиент (опционально) | Только свой профиль, абонемент, расписание, self check-in (киоск) |

**Бэкенд:** `JwtAuthGuard` + `RolesGuard` + декоратор `@Roles(...)`. **Фронт:** `router.beforeEach` + скрытие пунктов меню по роли (только UX; авторитет — всегда API).

### 0.3. Модули и функционал

1. **Dashboard** — KPI (активные клиенты, доход за месяц, посещения сегодня), графики по дням, фильтры дат. Доступ: все роли с разной детализацией при необходимости.
2. **Users / Employees** — сотрудники: email, роль, телефон, зарплата; поиск. ADMIN — полный CRUD и смена ролей; MANAGER — без изменения `role`.
3. **Clients** — клиенты: ФИО, контакты, фото, дата рождения, заметки/замеры (по этапам). ADMIN/MANAGER — полный CRUD; TRAINER — ограниченный список; RECEPTIONIST — чтение + чек-ин.
4. **Memberships** — типы (monthly/yearly/group), цена, даты, статус, продление, остаток визитов. Связь с `Client`, история посещений.
5. **Schedules / Classes** — группы/занятия: название, тренер, время, вместимость, запись (booking). Календарь на фронте.
6. **Attendance** — чек-ин/аут (QR или вручную), лимиты по абонементу, история.
7. **Payments** — суммы, даты, статусы; напоминания о долгах; опционально Stripe.
8. **Reports** — CSV/PDF, фильтры по датам/тренерам. ADMIN — полный экспорт; MANAGER — чтение/ограниченный экспорт по политике.
9. **Settings** — название центра, базовые цены, уведомления (email/SMS — позже), резервные копии; **пресеты темы и язык по умолчанию** (см. раздел 5).

### 0.4. Модель данных (логика)

- **User** — учётная запись (логин), роль, признак сотрудника; опциональная связь **1:1** с **Client** для роли TRAINEE.
- **Client** — карточка клиента; **Membership** привязан к `Client`, не к `User` сотрудника.
- **GymClass**, **Booking**, **Attendance**, **Payment** — как в [prisma-target-schema.prisma](prisma-target-schema.prisma); связи уточняй по мере внедрения модулей.

---

## 1. Подготовка окружения (1 день, общее)

### Шаг 1.1: Установи инструменты

**Что сделать**

- **Node.js** — версия проекта зафиксирована в корневом **`.nvmrc`** (сейчас **22.22.1**, LTS-ветка 22.x). Менеджер пакетов: **npm** или **pnpm** / **yarn**.
- **PostgreSQL** 16 и **Redis** 7 (кэш, сессии refresh-токенов при желании) — удобнее через **Docker Compose** (см. раздел 5.3).
  - Пример одноразово: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=pass postgres` и `docker run -p 6379:6379 redis:7-alpine`.
- **Git**, **VS Code**: расширения **Prisma**, **NestJS Snippets**, **Vue — Official** (Volar), **ESLint**.

**Почему так**

- Фиксированные версии стека снижают расхождения «у меня работает».
- Docker для БД избавляет от долгой настройки PostgreSQL на машине, если тебе достаточно контейнера.

**Проверка**

- `node -v`
- `docker --version` (если используешь Docker)

---

### Шаг 1.2: Создай репозитории

**Что сделать**

- На GitHub: **два репозитория** (`backend`, `frontend`) **или** один **monorepo** — на твой выбор и процесс деплоя.
- Локально: `git init` в корне каждого проекта (или один раз в monorepo).

**Почему так**

- Раздельные репо упрощают независимый деплой и права доступа.
- Monorepo удобен, если одна команда ведёт всё вместе и нужны общие типы/контракты.

**Пример команд**

```bash
git init backend
git init frontend
```

*(В monorepo — один `git init` в корне и папки `apps/backend`, `apps/frontend` и т.д.)*

---

## 2. Бэкенд: NestJS + Prisma + Postgres (ориентир 4–5 недель)

### 2.1. Инициализация проекта (1 день)

#### Шаг 2.1.1: Создай NestJS-проект

**Что сделать**

```bash
cd backend
npx @nestjs/cli new . --package-manager npm
```

**Почему так**

- CLI даёт готовый каркас: модули, контроллеры, точка входа, структура папок.

**Дополнительно**

- По желанию убери лишнее из шаблона (например дефолтный `app.controller`), приведи `main.ts` к своим настройкам (префикс API, валидация, CORS — позже).

---

#### Шаг 2.1.2: Подключи Prisma

**Что сделать**

```bash
npm i prisma @prisma/client @nestjs/config
npx prisma init
```

В `.env`:

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/fitnessdb"
REDIS_URL="redis://localhost:6379"
JWT_ACCESS_SECRET="change-me"
JWT_REFRESH_SECRET="change-me-refresh"
```

Создай базу в PostgreSQL, например:

```bash
createdb fitnessdb
```

**Почему так**

- **Prisma** — типобезопасный доступ к БД и миграции как версионируемая схема.
- `@nestjs/config` — централизованная загрузка переменных окружения.

---

#### Шаг 2.1.3: Базовая схема Prisma (`schema.prisma`)

**Что сделать**

Опиши модели и перечисления, затем:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

*(Сид `npx prisma db seed` подключишь после добавления `seed.ts` в `package.json`.)*

**Почему так**

- Разделение **User** (логин/роль) и **Client** (карточка посетителя) упрощает RBAC и сценарий TRAINEE.
- **Enum** для ролей и статусов уменьшает мусорные строки в БД и упрощает валидацию.

**Целевая схема:** используй файл [prisma-target-schema.prisma](prisma-target-schema.prisma) как эталон для миграций (можно внедрять поэтапно: сначала `User` + `Client` + `Membership`, затем классы и платежи).

**Минимальный первый шаг (если хочешь совсем короткий init):** одна миграция только с `User` (роли ADMIN … TRAINEE) и `ThemeSettings`, затем добавляй `Client` и `Membership` второй миграцией — так проще отладить auth.

---

#### Шаг 2.1.4: Prisma в NestJS

**Что сделать**

- Создай **`PrismaModule`** и **`PrismaService`**, который расширяет `PrismaClient`.
- Зарегистрируй модуль глобально или импортуй там, где нужен доступ к БД.

**Почему так**

- Один экземпляр клиента на приложение (singleton через DI Nest) — стандартная практика, проще тестировать и закрывать соединения.

**Пример сервиса**

```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

*(Подключение `DATABASE_URL` обычно идёт из `.env` через Prisma; отдельно передавать в `super()` не обязательно, если используешь стандартный `datasource`.)*

---

#### Шаг 2.1.5: Плагины и инфраструктура бэкенда (в первую неделю, по мере надобности)

**Установка (ориентир)**

```bash
npm i @nestjs/cache-manager cache-manager-ioredis-yet ioredis
npm i @nestjs/throttler @nestjs/swagger
npm i class-validator class-transformer
npm i nest-winston winston
# опционально: сообщения об ошибках на разных языках
npm i @nestjs/i18n
```

**Что подключить**

| Назначение | Пакет | Как использовать |
|------------|--------|-------------------|
| Валидация входа | `class-validator`, `class-transformer` | Глобальный `ValidationPipe` в `main.ts`, DTO на каждый body/query |
| Кэш отчётов и тяжёлых списков | `@nestjs/cache-manager` + **Redis** (`cache-manager-ioredis-yet`, `ioredis`) | `CacheModule.registerAsync`, `@CacheTTL(60)` на GET; **инвалидация** ключей при POST/PATCH/DELETE затрагиваемых сущностей |
| Защита от брутфорса / спама | `@nestjs/throttler` | Глобально + ужесточение на `/auth/login` |
| Документация API | `@nestjs/swagger` | `DocumentBuilder`, DTO с `@ApiProperty` |
| Логи | `nest-winston`, `winston` | JSON-логи, уровни, в проде — ротация/отправка в систему мониторинга |
| i18n ошибок (опц.) | `@nestjs/i18n` | Коды ошибок + переводы; согласовать с `vue-i18n` на фронте |

**Почему Redis отдельно от Postgres:** in-memory кэш Nest не разделяется между инстансами PM2; Redis даёт единый слой для нескольких процессов и будущего горизонтального масштаба.

---

### 2.2. Аутентификация (2 дня)

#### Шаг 2.2.1: Зависимости

```bash
npm i @nestjs/jwt @nestjs/passport passport passport-jwt passport-local bcrypt class-validator class-transformer
npm i -D @types/passport-jwt @types/bcrypt @types/passport-local
```

**Почему так**

- **JWT** — stateless-токены для API админки.
- **Passport** — проверенные стратегии local/jwt.
- **bcrypt** — безопасное хеширование паролей.
- **class-validator / class-transformer** — валидация DTO на входе.

---

#### Шаг 2.2.2: AuthModule

**Что сделать**

```bash
nest g module auth
nest g service auth
nest g controller auth
```

В **AuthService**: регистрация (хеш пароля), логин (проверка + выдача пары **access** + **refresh**). Refresh храни в httpOnly cookie или в БД/Redis с ротацией и отзывом.

**Почему так**

- Пароли никогда не хранятся в открытом виде.
- Короткоживущий access и долгоживущий refresh снижают риск при утечке токена.
- В payload access JWT: `sub` (id пользователя), `role` — для guard’ов; **не доверяй** роли с клиента, только проверка подписи на сервере.

**Пример логики логина**

```typescript
async login(email: string, password: string) {
  const user = await this.prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new UnauthorizedException();
  }
  return {
    access_token: this.jwtService.sign({ sub: user.id, role: user.role }),
  };
}
```

---

#### Шаг 2.2.3: Guards и DTO

**Что сделать**

- **JwtAuthGuard** — проверка токена.
- **RolesGuard** + декоратор `@Roles('ADMIN')` — ограничение по ролям.
- **DTO** для входа, например `LoginDto` с `@IsEmail()`, `@IsString()`, `@MinLength()` и т.д.
- Включи **ValidationPipe** глобально в `main.ts`.

**Почему так**

- Защита на уровне guard’ов повторно используется на всех админ-эндпоинтах.
- DTO отсекают невалидные данные до бизнес-логики.

---

#### Шаг 2.2.4: Тесты

**Что сделать**

- `npm run test` (Jest): unit-тесты на `AuthService` (успешный/неуспешный логин, регистрация).

**Почему так**

- Аутентификация — критичный модуль; регрессии здесь особенно болезненны.

---

### 2.3. Модуль Users (2 дня)

#### Шаг 2.3.1: Генерация

```bash
nest g module users
nest g service users
nest g controller users
```

---

#### Шаг 2.3.2: CRUD

**Что сделать**

В **UsersService**: `findAll` (с пагинацией), `findOne`, `create`, `update`, `delete`.

**Почему так**

- Админ-панель почти всегда показывает таблицы; **offset/limit** или **cursor** нужны, чтобы не тянуть всю БД.

**Идея для контроллера**

- Query-параметры `page`, `limit` (или свой `PaginationDto`), маппинг в `skip`/`take` Prisma.

---

#### Шаг 2.3.3: Защита

**Что сделать**

- **ADMIN** — полный CRUD сотрудников и смена ролей; **MANAGER** — создание/редактирование без поля `role` (или игнорирование его на сервере); остальные роли — по матрице из раздела 0.

**Почему так**

- Разделение ролей — базовая модель безопасности для внутренней панели.

---

### 2.4. Модуль Memberships (3 дня)

#### Шаг 2.4.1: Расширение схемы

**Что сделать**

- Добавь сущности **Attendance**, **GymClass** (и связи с **Membership** / расписанием) в `schema.prisma`, затем миграция.

**Пример Attendance**

```prisma
model Attendance {
  id           String     @id @default(cuid())
  membershipId String
  checkIn      DateTime
  checkOut     DateTime?
  membership   Membership @relation(fields: [membershipId], references: [id])

  @@map("attendances")
}
```

*(Не забудь добавить обратное поле `Attendance[]` в `Membership`, если связь однозначная.)*

---

#### Шаг 2.4.2: CRUD и бизнес-логика

**Что сделать**

- При создании абонемента: проверка `endDate > startDate` (если `endDate` задана).
- Смена статуса: при истечении срока — **EXPIRED** (cron через `@nestjs/schedule`, фоновая задача, или вычисление при чтении — выбери один явный подход).

**Почему так**

- Правила домена живут в **сервисах**, а не в контроллерах: проще тестировать и переиспользовать.

---

### 2.5. Остальные модули (Payments, Schedules, Reports) — ориентир 1 неделя

**Что сделать**

- По тому же шаблону: модуль → сервис → контроллер → DTO → guards.
- **Reports**: агрегации через Prisma (`groupBy`, `_sum`) или аккуратно параметризованный `$queryRaw` для сложных отчётов.
- **Swagger**: `npm i @nestjs/swagger`, `@ApiTags`, описание DTO — удобство для фронта и интеграций.

**Почему так**

- Единообразие модулей ускоряет разработку и онбординг.
- Swagger как живой контракт API.

---

### 2.6. Финализация бэкенда (1 день)

**Что сделать**

- **CORS** в `main.ts`: для dev можно `origin: '*'`, для prod — только домен фронта.
- **Seed**: тестовые пользователи/абонементы (например **faker**), скрипт в `package.json` → `prisma db seed`.
- Запуск: `npm run start:dev`.

**Почему так**

- Сиды экономят время при ручной проверке UI и демо.

---

## 3. Фронтенд: Vue 3 (ориентир 4–5 недель)

### 3.1. Инициализация (1 день)

#### Шаг 3.1.1: Создай проект и UI-стек

```bash
npm create vue@latest .
```

В мастере включи **TypeScript**, **Vue Router**, **Pinia**, **ESLint**. Стиль — по желанию (рекомендуется совместимость с **Tailwind**, если пойдёшь через пресеты Vuestic).

**UI-фреймворк: Vuestic UI** ([vuestic.dev](https://vuestic.dev)) — Vue 3, таблицы/формы/модалки, тёмная тема, кастомизация через **CSS variables** (акцентный цвет пресета).

```bash
npm i vuestic-ui
npm i vue-i18n@9
npm i vee-validate @vee-validate/zod zod
npm i @vueuse/core
npm i pinia-plugin-persistedstate
npm i gsap
npm i vue3-apexcharts apexcharts
npm i @zxing/library
# опционально PWA: workbox-window + vite-plugin-pwa
```

**Почему так**

- **Pinia** + **persist** — состояние авторизации и пользовательские настройки темы/языка переживают перезагрузку (чувствительные данные — только то, что допустимо в `localStorage`).
- **vue-i18n** — RU/EN для подписей, таблиц, ошибок форм (совместно с сообщениями от API).
- **VeeValidate + Zod** — одна схема валидации, типобезопасность.
- **ApexCharts** — дашборды; при желании часть графиков можно заменить на встроенные виджеты Vuestic, если покроют сценарий.
- **GSAP / VueUse** — анимации и утилиты без лишнего веса; **@vueuse/motion** — опционально для простых transition.
- **@zxing/library** — скан QR для чек-ина.

**Замечание по сборке:** `vite-plugin-purgecss` с **Tailwind v4+** может конфликтовать — проверяй tree-shaking Vite и документацию Vuestic; цель — не ломать стили компонентов.

---

#### Шаг 3.1.2: Плагины приложения (`main.ts`), layout, i18n, темы

**Что сделать**

- Подключи `createVuestic()` с **presets** цветов (например blue / green / orange / purple / red) и переключателем **dark/light**; сохраняй выбор в `localStorage` и при наличии — синхронизируй с API `ThemeSettings` для дефолта новых пользователей.
- `createI18n` с файлами `locales/en.json`, `locales/ru.json`; переключатель языка в **header**.
- `components/layout/AppLayout.vue`: **VaSidebar** (пункты меню фильтруй по `role`), **VaNavbar** (user, язык, тема, выход).
- `views/Login.vue`: форма на Vuestic + VeeValidate → `POST /api/auth/login`.

**Почему так**

- Пресеты через **CSS variables** (`--va-primary`, и т.д. по документации Vuestic) позволяют менять акцент без пересборки всего UI.
- Меню по ролям уменьшает ошибки и шум; снова: это только UX, защита — на бэкенде.

---

#### Шаг 3.1.3: Axios и store авторизации

**Что сделать**

- `utils/api.ts`: `axios.create({ baseURL: 'http://localhost:3000/api' })`, перехватчик для заголовка `Authorization: Bearer <token>`.
- `stores/auth.ts`: действия login/logout, хранение токена (например `localStorage` + reactive state).

**Почему так**

- Один настроенный клиент исключает дублирование base URL и логики заголовков.

---

### 3.2. Dashboard (2 дня)

#### Шаг 3.2.1: Компоненты

**Что сделать**

- `views/Dashboard.vue`: **VaCard** / KPI, **vue3-apexcharts** для линий/столбцов; таблицы краткой сводки — **VaDataTable** с серверной пагинацией.
- Ленивая загрузка тяжёлых виджетов: `defineAsyncComponent` или async routes.
- Сначала **mock** или **MSW**, затем API из модуля Reports/Dashboard.

**Почему так**

- Верстка и UX не блокируются готовностью всех API.

---

#### Шаг 3.2.2: Router guards

**Что сделать**

- В `router/index.ts`: `beforeEach` — проверка токена и при необходимости роли для админ-маршрутов.

**Почему так**

- Защита маршрутов на клиенте дополняет серверные guard’ы (но не заменяет их).

---

### 3.3. Модуль Users (3 дня)

**Что сделать**

- `components/users/UsersTable.vue`: **VaDataTable** (сортировка, пагинация, опционально **virtual scroller** для больших списков по доке Vuestic).
- **VaModal** + формы с **VeeValidate + Zod**; для MANAGER скрывай/отключай поле роли на уровне UI и дублируй запрет в API.

**Почему так**

- Готовые таблицы дают сортировку, пагинацию, фильтрацию с меньшим объёмом кода.

---

### 3.4. Memberships и остальное (ориентир 2 недели)

**Что сделать**

- Таблицы и формы по тем же паттернам.
- Расписание: например **FullCalendar**.
- Фильтры: статус, тип абонемента.
- Посещаемость / QR: например `@zxing/library` для сканирования (если сценарий в браузере).

**Почему так**

- Единые UX-паттерны снижают когнитивную нагрузку у пользователей панели.

---

### 3.5. Финализация фронтенда (2 дня)

**Что сделать**

- **MSW** для моков API в разработке/тестах: `npm i msw`.
- Тесты: **Vitest** (юнит), **Cypress** или **Playwright** (e2e по желанию).
- Сборка: `npm run build`, проверка `preview`.

**Почему так**

- Моки стабилизируют фронт до полной готовности бэка; e2e ловят регрессии сценариев.

---

## 4. Интеграция и тесты (3–5 дней)

**Что сделать**

- Убрать моки там, где API готовы; выровнять контракты (типы, поля, коды ошибок).
- E2E-сценарии: логин → dashboard → CRUD по ключевым сущностям.
- Покрытие на бэке: `npm run test:cov` (если настроено в Nest).
- Опционально: генерация **TypeScript-типов** для фронта из OpenAPI (`openapi-typescript` и аналоги), чтобы не расходиться с DTO.

**Почему так**

- Интеграция в конце выявляет расхождения в DTO и прав доступа до продакшена.

---

## 5. Стек: плагины, i18n, темы, деплой

### 5.1. Сводка по фронтенду

| Категория | Выбор | Заметка |
|-----------|--------|---------|
| UI | Vuestic UI | Таблицы, формы, тосты, темы |
| Состояние | Pinia + pinia-plugin-persistedstate | Токен/настройки — осознанно, без секретов |
| i18n | vue-i18n | Ключи вида `dashboard.kpi.active` |
| Валидация | VeeValidate + Zod | Сообщения через i18n |
| Графики | ApexCharts + vue3-apexcharts | Дашборд |
| Анимации | GSAP, VueUse | Умеренно, не блокировать main thread |
| QR | @zxing/library | Чек-ин |
| Markdown (заметки, био) | markdown-it + небольшой Vue-обёртка или готовый пакет | Санитизация HTML (DOMPurify) при выводе |
| Кэш / PWA | workbox (vite-plugin-pwa) | По необходимости; статика админки |

### 5.2. Темы и пресеты (практика)

- Храни в БД **`ThemeSettings`**: `defaultPreset`, `defaultLocale` — для новых пользователей и киоска.
- В браузере: `localStorage` ключи `theme`, `preset`, `locale`; при логине можно перезаписать из профиля пользователя, если добавишь поля в API.
- Пять пресетов: задай объекты `{ name, primary: '#...' }` и передай в конфиг Vuestic / переопределение CSS variables.

### 5.3. Деплой: Docker Compose + Nginx + PM2 (один VPS)

**Идея:** контейнер **PostgreSQL**, контейнер **Redis**; приложение **Nest** под **PM2** (или в контейнере Node — на твой выбор); **Nginx** раздаёт статику Vue (`dist`) и проксирует `/api` на порт Nest (например 3000).

**Пример фрагмента `docker-compose.yml` (только БД и Redis)**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fitness
      POSTGRES_PASSWORD: fitness
      POSTGRES_DB: fitnessdb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
volumes:
  pgdata: {}
```

**Пример фрагмента Nginx**

```nginx
server {
  listen 443 ssl;
  server_name admin.example.com;
  root /var/www/fitness-admin/dist;
  location / {
    try_files $uri $uri/ /index.html;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**PM2:** `ecosystem.config.cjs` с `instances: max` или `1` для старта, логи в файлы, `restart` на деплое.

---

## 6. Лучшие практики (краткий чеклист)

1. **Единственный источник правды для прав** — бэкенд. На фронте меню и кнопки скрываются для UX; каждый мутационный запрос всё равно проверяется guard’ами и сервисом.
2. **DTO + ValidationPipe** на все входы; в Prisma не передавай сырые объекты с клиента — whitelist полей.
3. **RBAC:** декларативный список разрешений по ролям (константы или таблица) лучше, чем размазанные `if (role === …)` по десятку файлов; по мере роста вынеси в матрицу или CASL на бэке.
4. **Кэш:** осмысленные ключи (`report:dashboard:${from}:${to}`), TTL, **инвалидация** при изменении данных; не кэшируй персональные ответы без user id в ключе.
5. **JWT:** короткий access; refresh с ротацией; при logout — blacklist refresh в Redis (опционально).
6. **Безопасность:** HTTPS, заголовки (Nginx), throttler на auth; пароли только bcrypt/argon2; не логируй тела запросов с паролями.
7. **i18n:** стабильные ключи; для ошибок API — код (`ERR_MEMBERSHIP_EXPIRED`) + параметры; перевод на фронте.
8. **Производительность:** ленивые маршруты, виртуализация длинных таблиц, индексы в БД на поля поиска (`email`, `clientId`, даты посещений).
9. **Миграции Prisma** только через `migrate`; seed для локальной разработки.
10. **Наблюдаемость:** структурированные логи, health endpoint для Nginx/мониторинга.

---

## Как пользоваться этим документом

1. Прочитай **раздел 0** (продукт и RBAC) и **разделы 5–6** (стек, деплой, практики), затем иди **по порядку** с раздела 1: окружение → бэкенд → фронт → интеграция.
2. Отмечай выполненные шаги в своём трекере или чеклисте.
3. Сроки гибкие: переноси блоки, если один разработчик делает и API, и UI — можно чередовать, но **схема БД и auth** лучше зафиксировать раньше таблиц на фронте.
4. Для генерации кода в AI используй [AI_BRIEF_PROMPT.md](AI_BRIEF_PROMPT.md).

Удачи в разработке.
