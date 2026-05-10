# Деплой на VPS (31.70.72.232, домен 5fit.work.gd)

Краткий чеклист переноса монорепозитория в продакшен через Docker.

## 1. DNS и доступ

- Запись **A** для `5fit.work.gd` → `31.70.72.232` (при необходимости отдельно `www`).
- На сервере: Ubuntu/Debian с **Docker Engine** и **Docker Compose v2** (`docker compose`).
- Открыть входящие порты **22** (SSH), **80** (HTTP), **443** (HTTPS после выпуска сертификата).
- Для **MinIO**: **9100** (S3 API), **9101** (веб-консоль), например: `sudo ufw allow 9100/tcp` и `sudo ufw allow 9101/tcp`.

## 2. Код на сервере

```bash
git clone <ваш-репозиторий> fitnessApp
cd fitnessApp
cp deploy/env.production.example deploy/.env.production
nano deploy/.env.production   # POSTGRES_PASSWORD, JWT_ACCESS_SECRET, проверьте CORS_ORIGIN
```

Не коммитьте `deploy/.env.production` — файл с секретами только на сервере.

## 3. Первый запуск

Флаг **`--env-file deploy/.env.production`** нужен, чтобы подставить `POSTGRES_PASSWORD` в `DATABASE_URL` и переменные для Postgres.

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml exec api npx prisma db seed
```

После сида войти как **admin** / **Admin123!** и сменить пароль.

Проверка: открыть `http://5fit.work.gd` (до HTTPS).

## 4. HTTPS (Let’s Encrypt)

На хосте установите Certbot и получите сертификаты для `5fit.work.gd` и `www.5fit.work.gd`. Дальше возможны варианты:

- Вынести TLS на отдельный **Caddy** или **Traefik** перед контейнером `web`, или
- Подключить сертификаты к **Nginx** в образе `web`: добавить `listen 443 ssl`, пути к `fullchain.pem` / `privkey.pem` и проброс `443:443` в `docker-compose.prod.yml`.

Важно: при HTTPS в `deploy/.env.production` должны быть `COOKIE_SECURE=true` и актуальный `CORS_ORIGIN` с `https://`.

## 5. Обновление приложения

```bash
cd fitnessApp
git pull
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --build
```

Миграции Prisma выполняются при старте контейнера `api` (`prisma migrate deploy`).

## 6. Замечания

- Контейнер **api** содержит **Chromium** для генерации PDF договоров (Puppeteer).
- Шаблон **PDF** для AcroForm при необходимости положите в `backend/templates/` и пересоберите образ `api`.
- Redis в текущем коде не используется — в compose prod не включён.

## 7. MinIO (как локально)

В `docker-compose.prod.yml` есть сервис **minio** (порты **9100** / **9101**). В `deploy/.env.production` заполните **`MINIO_ROOT_*`** и блок **`S3_*`** по образцу из `deploy/env.production.example`: **`S3_SECRET_ACCESS_KEY`** совпадает с **`MINIO_ROOT_PASSWORD`**, **`S3_ENDPOINT`** и **`S3_PUBLIC_BASE_URL`** — с вашим **публичным IP или доменом** и портом **9100**. Консоль MinIO: `http://ВАШ_IP:9101`. После `git pull` выполните `docker compose ... up -d` (пересборка образов не обязательна, если менялись только compose/env).
