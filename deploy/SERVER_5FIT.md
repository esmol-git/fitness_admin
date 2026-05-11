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

Краткий порядок для **TLS перед Docker** (частый вариант): на хосте **Caddy** или **nginx** на **443** с сертификатами Certbot, прокси на **`127.0.0.1:80`** (куда проброшен контейнер `web`). Тогда в compose можно не трогать **443** у `web`. После выпуска сертификатов перезапустите стек и проверьте вход по **https://**.

## 5. Обновление приложения

```bash
cd fitnessApp
git pull
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --build
```

Миграции Prisma выполняются при старте контейнера `api` (`prisma migrate deploy`).

На **малом диске / малой RAM** надёжнее не смешивать долгую пересборку и **`up`**: Compose может снова запускать **`build`** во время **`up`**, из‑за чего **`api`** долго не слушает порт. **`web`** ждёт только **`api`** (**`service_started`**): nginx поднимается сразу, несколько секунд возможны **502** на `/api`, пока Nest не готов.

Надёжная последовательность без лишнего **`build`** при **`up`**:

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml build api
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml build web
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --no-build --force-recreate api web
```

## 6. Замечания

- **PDF договоры и Chromium.** Образ с **`INSTALL_CHROMIUM=1`** тянет пакет **chromium** из Debian (~700 MB только apt + слои Docker + `npm ci`). На VPS с диском **~8–10 GB** сборка почти всегда заканчивается **`No space left on device`** (как на **`dpkg ... chromium`**, так и на распаковке слоя). На таком сервере держите **`INSTALL_CHROMIUM=0`**: форма договора вернёт **503** по PDF до тех пор, пока вы не **увеличите диск**, не соберёте образ **`api`** на машине с запасом места и не загрузите его в registry (**`docker pull`** на VPS), либо не вынесете генерацию PDF в отдельный сервис.
- Если места достаточно (или сборка в CI): **`INSTALL_CHROMIUM=1`** в **`deploy/.env.production`**, затем **`build api`** и **`up`**.
- Шаблон **PDF** для AcroForm при необходимости положите в `backend/templates/` и пересоберите образ `api`.
- Redis в текущем коде не используется — в compose prod не включён.

## 7. Мало места на диске (`no space left on device`)

На маленьких VPS образ MinIO и Chromium в `api` быстро забивают диск.

```bash
df -h /
docker system df
docker builder prune -af
docker image prune -af    # часто даёт гигабайты: старые fitnessapp-api/web без тега
docker system prune -af   # не добавляйте --volumes без понимания — удалите том postgres
```

После **прерванной** сборки (`COPY node_modules`, `unpacking ... no space`, файлы вроде **`query_compiler*.wasm`**) обязательно выполните prune и проверьте **`df -h`**: часть места занята «висячими» слоями BuildKit до очистки. Для образа **`api`** с Prisma и зависимостями реалистично иметь **≥4–6 GB свободно на `/`** только под одну успешную сборку и распаковку слоёв.

При необходимости увеличьте диск у провайдера до **≥15–20 GB** свободного под образы и сборки.

Образ **`api`** в репозитории собирается так, чтобы **не копировать `node_modules` из стадии builder** (меньше пиковое место на диске) и чтобы **`PUPPETEER_SKIP_DOWNLOAD`** не тянул второй Chromium при `npm ci`.

Если ошибка падает на шаге **`apt-get install chromium`** внутри Dockerfile (**`dpkg ... No space left on device`**), освободите место и повторите сборку либо соберите образ **`api` локально или в CI** и загрузите в registry, а на VPS делайте только **`pull`**.

## 8. MinIO (опционально)

Сервис **minio** включён только с профилем **`minio`** — базовый `up` не тянет образ MinIO и не жрёт место под него.

С MinIO:

```bash
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml --profile minio up -d --build
```

В `deploy/.env.production` заполните **`MINIO_ROOT_*`** и блок **`S3_*`** по образцу из `deploy/env.production.example`: ключи совпадают с MinIO. **`S3_ENDPOINT`** — адрес, который попадает в **presigned URL** (должен открываться из браузера), обычно `http://ВАШ_IP:9100`. **`S3_INTERNAL_ENDPOINT=http://minio:9000`** — для запросов SDK из контейнера **`api`** к MinIO по Docker-сети (иначе часто таймаут на публичный IP своего VPS). **`S3_PUBLIC_BASE_URL`** — база для отображаемых URL объектов. Консоль MinIO: `http://ВАШ_IP:9101`. UFW: порты **9100**, **9101**.

Без MinIO (экономия диска): запускайте **без** `--profile minio` и **очистите `S3_BUCKET`** в `.env.production` (оставьте пустым), иначе вызовы storage могут зависать или давать ошибки.

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

После `git pull` с актуальным репозиторием **`web` ждёт только старт контейнера `api`** (**`service_started`**); healthcheck **`api`** отражает готовность порта **3000**, но не блокирует подъём nginx.

## 10. Быстрый деплой (узкий VPS, ~8 GB диска)

```bash
cd /opt/fitnessApp
git pull

docker compose --env-file deploy/.env.production -f docker-compose.prod.yml down
docker builder prune -af
docker image prune -af
docker container prune -f
df -h

# Инфраструктура без сборки приложений (при нужде MinIO — с профилем)
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml --profile minio up -d --no-build postgres minio

# Сборка только по очереди (не «build api web» одной командой)
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml build --no-cache api
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml build --no-cache web

docker compose --env-file deploy/.env.production -f docker-compose.prod.yml --profile minio up -d --no-build --force-recreate api web

docker compose --env-file deploy/.env.production -f docker-compose.prod.yml ps
curl -sS http://127.0.0.1/api/health/live
```

Рекомендуется **`INSTALL_CHROMIUM=0`** на этом классе VPS, если образ **`api`** собираете **на сервере**. Если образ с Chromium приходит **из GHCR** (см. §11), на VPS **`INSTALL_CHROMIUM`** влияет только на локальный **`build`** (который при деплое из registry не вызывают).

## 11. CI: образ `api` с Chromium в GHCR (без `docker build` на VPS)

В репозитории workflow **`.github/workflows/docker-api.yml`**: при пуше в **`main`**, если менялся **`backend/**`**, собирается образ с **`INSTALL_CHROMIUM=1`** и публикуется в **GitHub Container Registry**:

- **`ghcr.io/<owner-lowercase>/<repo-lowercase>/fitness-api:latest`**
- тот же реестр с тегом **`:<git-sha>`**

После первого успешного прогона откройте **Actions** → последний run → шаг **Summary** с полными именами образов.

### Настройка доступа к пакету

- Репозиторий **публичный** — **`docker pull`** с VPS без логина (достаточно указать **`API_IMAGE`**).
- Репозиторий **приватный** — на VPS один раз: **`docker login ghcr.io`** (PAT GitHub с правом **`read:packages`**, пользователь — ваш GitHub username).

### VPS: `deploy/.env.production`

```env
API_IMAGE=ghcr.io/ВАШ_OWNER/ВАШ_РЕПО/fitness-api:latest
WEB_IMAGE=ghcr.io/ВАШ_OWNER/ВАШ_РЕПО/fitness-web:latest
```

Дополнительно (MinIO из контейнера `api` без таймаута на свой публичный IP):

```env
S3_INTERNAL_ENDPOINT=http://minio:9000
```

### Деплой только pull (без сборки api/web на диске VPS)

Образ **`web`**: workflow **`.github/workflows/docker-web.yml`** (изменения в **`frontend/**`**) → **`ghcr.io/<owner>/<repo>/fitness-web:latest`**. В **`deploy/.env.production`** задайте **`WEB_IMAGE`** (по желанию вместе с **`API_IMAGE`**).

```bash
cd /opt/fitnessApp
git pull

docker compose --env-file deploy/.env.production -f docker-compose.prod.yml pull api web

docker compose --env-file deploy/.env.production -f docker-compose.prod.yml --profile minio up -d --no-build --force-recreate api web
```

Если **`WEB_IMAGE`** не задан: **`pull api`**, затем **`build web`** на сервере (или один раз запустите **Docker Web** в Actions и задайте **`WEB_IMAGE`**).

**Важно:** CI снимает нехватку места **на этапе сборки**. **RAM 1 GB** на VPS по-прежнему может не хватить на **одновременную** работу Postgres, API и **Chromium при генерации PDF** — полноценный прод лучше планировать с **≥4 GB RAM** и запасом диска под данные.

## 12. Пока ждёте апгрейд сервера (чеклист)

1. **CI** — пуш в **`main`** по **`backend/`** (workflow **Docker API**) и/или по **`frontend/`** (**Docker Web**), либо вручную **Run workflow** для обоих. Пакеты в **Packages** / GHCR.
2. **VPS** — в **`deploy/.env.production`** задайте **`API_IMAGE`** и при необходимости **`WEB_IMAGE`** (§11); при приватном репозитории — **`docker login ghcr.io`**.
3. **Деплой** — **`pull api`** (и **`pull web`**, если задан **`WEB_IMAGE`**) и **`up --no-build`**; иначе **`web`** — **`build web`** на сервере.
4. **HTTPS** — §4 и краткая подсказка выше; обновите **`CORS_ORIGIN`** / **`COOKIE_SECURE`**.
5. **Полная приёмка договоров + PDF** — на стенде с **≥4 GB RAM** или после апгрейда прод-сервера.

## 13. Логи успешного старта `api`

В логах **`api`** после успешного старта в конце должна быть строка **`HTTP server listening on 0.0.0.0:3000`** (раньше — **`NestFactory.create finished`** и маппинг маршрутов). Если маршруты есть, а финальной строки нет — **`listen`** не завершился (смотрите полный **`logs api`**).
