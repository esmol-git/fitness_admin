# Backend API + Prisma + Chromium (Puppeteer / PDF договоров)
FROM node:22.22.1-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22.22.1-bookworm-slim AS runner

# 1 = полный образ с Chromium для PDF договоров (~700+ MB на диск при сборке).
# 0 = только openssl/ca-certificates — для узкого VPS; PDF через Puppeteer недоступен.
ARG INSTALL_CHROMIUM=1

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && if [ "$INSTALL_CHROMIUM" = "1" ]; then \
       apt-get install -y --no-install-recommends chromium fonts-liberation fontconfig; \
     fi \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY templates ./templates/

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
