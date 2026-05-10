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

- По умолчанию образ **api** ставит **Chromium** для PDF договоров (Puppeteer). Если при сборке не хватает места на диске, в **`deploy/.env.production`** задайте **`INSTALL_CHROMIUM=0`**, затем **`docker compose ... build api`** и **`up`**. PDF из HTML будет недоступен до сборки полного образа на машине с большим диском или после расширения диска VPS.
- Шаблон **PDF** для AcroForm при необходимости положите в `backend/templates/` и пересоберите образ `api`.
- Redis в текущем коде не используется — в compose prod не включён.

## 7. Мало места на диске (`no space left on device`)

На маленьких VPS образ MinIO и Chromium в `api` быстро забивают диск.

```bash
df -h /
docker system df
docker builder prune -af
docker system prune -af   # не добавляйте --volumes без понимания — удалите том postgres
```

После **прерванной** сборки (`COPY node_modules`, `overlayfs ... no space`) обязательно выполните prune и проверьте **`df -h`**: часть места занята «висячими» слоями BuildKit до очистки.

При необходимости увеличьте диск у провайдера до **≥15–20 GB** свободного под образы и сборки.

Образ **`api`** в репозитории собирается так, чтобы **не копировать `node_modules` из стадии builder** (меньше пиковое место на диске) и чтобы **`PUPPETEER_SKIP_DOWNLOAD`** не тянул второй Chromium при `npm ci`.

Если ошибка падает на шаге **`apt-get install chromium`** внутри Dockerfile (**`dpkg ... No space left on device`**), освободите место и повторите сборку либо соберите образ **`api` локально или в CI** и загрузите в registry, а на VPS делайте только **`pull`**.

## 8. MinIO (опционально)

Сервис **minio** включён только с профилем **`minio`** — базовый `up` не тянет образ MinIO и не жрёт место под него.

С MinIO:

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml --profile minio up -d --build
```

В `deploy/.env.production` заполните **`MINIO_ROOT_*`** и блок **`S3_*`** по образцу из `deploy/env.production.example`: ключи совпадают с MinIO, **`S3_ENDPOINT`** / **`S3_PUBLIC_BASE_URL`** — ваш IP или домен и порт **9100**. Консоль: `http://ВАШ_IP:9101`. UFW: порты **9100**, **9101**.

Без MinIO (экономия диска): запускайте **без** `--profile minio` и **очистите `S3_BUCKET`** в `.env.production` (оставьте пустым), иначе API при старте может падать при попытке подключиться к S3.

## 9. `Connection refused` с `web` на `http://api:3000`

Значит с **`web`** до процесса Node на порту **3000** не добиться: контейнер **`api` не слушает** (ещё не стартовал, упал после старта, завис на миграциях) или имя **`api`** в DNS указывает не на тот контейнер.

Проверьте по порядку:

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml ps
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml logs api --tail=100
```

С самого **`api`** (если контейнер в статусе **Up**):

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml exec api \
  node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>console.log(r.status)).catch(e=>{console.error(e);process.exit(1)})"
```

Если здесь ошибка — смотрите логи **`api`** (часто: миграции Prisma, база, нехватка памяти, ошибка при bootstrap).

Сверка IP контейнера **`api`** на хосте (должен совпасть с тем, что видит **`ping api`** из **`web`**):

```bash
docker inspect "$(docker compose --env-file deploy/.env.production -f docker-compose.prod.yml ps -q api)" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml exec web ping -c1 api
```

После `git pull` с актуальным репозиторием **`web` ждёт `service_healthy` для `api`**, чтобы не подниматься, пока localhost **`127.0.0.1:3000`** внутри **`api`** не начинает отвечать.
