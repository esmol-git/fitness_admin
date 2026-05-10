# Backend API + Prisma + Chromium (Puppeteer / PDF договоров)
FROM node:22.22.1-bookworm-slim AS builder

# Должен совпадать с ARG в runner (передаётся из docker-compose build.args).
ARG INSTALL_CHROMIUM=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

# Не качаем браузер Puppeteer — в runner используется системный Chromium или PDF недоступен без него.
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm ci \
  && if [ "$INSTALL_CHROMIUM" != "1" ]; then rm -rf node_modules/chromium-bidi; fi

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:22.22.1-bookworm-slim AS runner

# 1 = полный образ с Chromium для PDF договоров (~700+ MB на диск при сборке).
# 0 = slim: без Chromium и без тяжёлого chromium-bidi в node_modules (PDF недоступен на этом образе).
ARG INSTALL_CHROMIUM=1

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && if [ "$INSTALL_CHROMIUM" = "1" ]; then \
       apt-get install -y --no-install-recommends chromium fonts-liberation fontconfig; \
     fi \
  && rm -rf /var/lib/apt/lists/*

# Не копируем node_modules из builder — это почти удваивает пиковое место на диске при сборке.
# Ставим только production-зависимости в финальном слое.
COPY package*.json ./
COPY prisma ./prisma/

# postinstall @prisma/client создаёт .prisma — удаляем и подставляем сгенерированное в builder (один проход generate).
# Узкий диск: в npm-пакете есть тяжёлые артефакты компилятора под CockroachDB — datasource у нас только PostgreSQL.
RUN npm ci --omit=dev \
  && find node_modules/@prisma/client -name '*cockroachdb*' -delete 2>/dev/null || true \
  && if [ "$INSTALL_CHROMIUM" != "1" ]; then rm -rf node_modules/chromium-bidi; fi \
  && rm -rf node_modules/.prisma \
  && npm cache clean --force

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/dist ./dist
COPY templates ./templates/

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
