# Fitness App — админ-панель фитнес-центра

Монорепозиторий-заготовка: отдельные каталоги под API и SPA.

## Версия Node.js (локально и на сервере)

Зафиксировано: **22.22.1** (ветка **22.x LTS**). Текущая «нечётная» 25.x на машине не используем для этого проекта — меньше сюрпризов с Nest/Vite и проще совпасть с продом.

| Где | Что сделать |
|-----|-------------|
| Локально (nvm) | В корне репо: `nvm use` (читает [`.nvmrc`](.nvmrc)) или явно `nvm use 22.22.1` |
| Сервер | Поставить ту же версию: через nvm (`nvm install 22.22.1 && nvm alias default 22.22.1`), официальный бинарник с [nodejs.org](https://nodejs.org/), или образ Docker `node:22.22.1-alpine` |

Проверка: `node -v` → `v22.22.1`.

## Быстрый старт

### База данных

**Вариант A — Docker** (команда `docker` должна работать в терминале):

1. Установи [Docker Desktop для Mac](https://docs.docker.com/desktop/setup/install/mac-install/) (или [OrbStack](https://orbstack.dev/) как лёгкую альтернативу), перезапусти терминал.
2. Проверка: `docker --version` и `docker compose version`.
3. Из корня репозитория: `docker compose up -d`.  
   Postgres в контейнере доступен на хосте как **`127.0.0.1:5433`** (не 5432 — часто занят локальным PostgreSQL).

**Вариант B — без Docker** (локальный PostgreSQL на Mac):

1. Установи и запусти сервис, например:  
   `brew install postgresql@16`  
   `brew services start postgresql@16`  
   Добавь `postgresql@16` в `PATH`, если `psql` не находится (подскажет `brew info postgresql@16`).
2. Создай БД и пользователя под свои нужды или используй дефолтного пользователя ОС; в `backend/.env` укажи строку подключения, например:  
   `DATABASE_URL="postgresql://ИМЯ_ПОЛЬЗОВАТЕЛЯ_ОС@localhost:5432/fitnessdb"`  
   и создай базу: `createdb fitnessdb` (или через `psql`).
3. **Redis** для текущего кода бэкенда не обязателен; его можно подключить позже. `REDIS_URL` в `.env` пока можно не трогать.

### Запуск приложения

Выполняй команды **по отдельности** (строки с `#` в терминал не вставляй — это комментарии).

1. **Бэкенд** (из корня репозитория `fitnessApp`):  
   `cp backend/.env.example backend/.env`  
   `cd backend && npm install && npx prisma migrate deploy && npx prisma db seed && npm run start:dev`  
   Первый пользователь после сида: **admin@fitness.local** / **Admin123!** (смени пароль в проде).  
   API: [http://localhost:3000/api](http://localhost:3000/api) (JSON `{ "message": "Hello World!" }`).
2. **Фронтенд** — **новый терминал**, снова корень репозитория:  
   `cd frontend && npm install && npm run dev`  
   Если ты остался в каталоге `backend`, используй `cd ../frontend`.  
   Vite: [http://localhost:5173](http://localhost:5173).

### Ошибка Prisma `P1010` (доступ к БД)

Чаще всего Prisma подключается **не к Docker**, а к **другому** PostgreSQL на порту 5432 (например Homebrew). В проекте контейнер слушает **`127.0.0.1:5433`** — в `backend/.env` должно быть так же, как в [backend/.env.example](backend/.env.example).

Проверка контейнера:  
`docker compose exec postgres psql -U fitness -d fitnessdb -c 'select 1'`

После смены порта в `docker-compose.yml` перезапусти стек:  
`docker compose down && docker compose up -d`

### Ошибка `EADDRINUSE` на порту 3000

Порт уже занят — обычно **второй** запуск `npm run start:dev` или другой процесс.

- Посмотреть, кто слушает порт (macOS): `lsof -i :3000`
- Завершить процесс: `kill <PID>` (или `kill -9 <PID>`, если не отпустил)

Либо задай другой порт в `backend/.env`: `PORT=3001`, перезапусти бэкенд и в [frontend/vite.config.ts](frontend/vite.config.ts) в `server.proxy['/api'].target` укажи `http://localhost:3001`.

### Версия Node в логах

Если в конце ошибки указано не **v22.22.1**, в каталоге проекта выполни `nvm use` (см. [`.nvmrc`](.nvmrc)) и снова запусти бэкенд.

Тесты бэка: `cd backend && npm test && npm run test:e2e`. Сборка фронта: `cd frontend && npm run build`.

## Деплой прод (VPS)

- **[deploy/SERVER_5FIT.md](deploy/SERVER_5FIT.md)** — DNS, Docker Compose, MinIO, HTTPS, узкий диск, **образы из GHCR** (`API_IMAGE` / `WEB_IMAGE`).
- В GitHub Actions: **Docker API (GHCR)** и **Docker Web (GHCR)** — сборка без Chromium на сервере; на VPS достаточно **`docker compose pull`** и **`up --no-build`**.
- Скрипт **`deploy/scripts/vps-pull-up.sh`** — один проход **`pull` + `up`** и проверка health (см. **`deploy/SERVER_5FIT.md`** §11).

## Документы

- **[docs/ADMIN_PANEL_DEVELOPMENT_PLAN.md](docs/ADMIN_PANEL_DEVELOPMENT_PLAN.md)** — пошаговый план, RBAC, Vuestic, i18n, темы, плагины, деплой, лучшие практики.
- **[docs/FRONTEND_UI_FOUNDATION.md](docs/FRONTEND_UI_FOUNDATION.md)** — токены UI, формы (Vuelidate), роутинг и шелл приложения.
- **[docs/prisma-target-schema.prisma](docs/prisma-target-schema.prisma)** — целевая схема БД (User / Client / Membership / …).
- **[docs/AI_BRIEF_PROMPT.md](docs/AI_BRIEF_PROMPT.md)** — готовый промпт для Copilot / ChatGPT.

## Структура

| Каталог | Назначение |
|--------|------------|
| `backend/` | NestJS 11, Prisma 6, PostgreSQL, глобальный префикс `/api`, `PrismaModule` |
| `frontend/` | Vue 3, Vite 8, Pinia, Vuestic UI, vue-i18n (RU/EN), пресеты акцента, прокси на API |
| `docs/` | Планы и промпты |
| `docker-compose.yml` | Postgres 16 + Redis 7 для локальной разработки |

Дальнейшие модули (auth, CRUD) — по [docs/ADMIN_PANEL_DEVELOPMENT_PLAN.md](docs/ADMIN_PANEL_DEVELOPMENT_PLAN.md).

cd /opt/fitnessApp   # или ваш путь к клону
git pull
./deploy/scripts/vps-pull-up.sh --minio