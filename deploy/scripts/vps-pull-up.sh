#!/usr/bin/env bash
# Обновление api + web с GHCR (или локальных тегов) без сборки на сервере.
# Запуск из корня репозитория: ./deploy/scripts/vps-pull-up.sh
# С MinIO: ./deploy/scripts/vps-pull-up.sh --minio
#
# Переменные (опционально):
#   ENV_FILE   — путь к env (по умолчанию deploy/.env.production)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

PROFILE_ARGS=()
if [[ "${1:-}" == "--minio" ]]; then
  PROFILE_ARGS=(--profile minio)
  shift
fi

echo ">>> pull api web"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" pull api web

echo ">>> up --no-build (api web)"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" up -d --no-build --force-recreate api web

echo ">>> ps"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" ps

echo ">>> ждём ответ /api/health/live (до ~30 с)…"
ok=0
for _ in 1 2 3 4 5 6; do
  if curl -fsS --max-time 5 "http://127.0.0.1/api/health/live" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done
if [[ "$ok" -eq 1 ]]; then
  echo ">>> GET /api/health/live — ok"
else
  echo ">>> GET /api/health/live — нет ответа (смотрите: docker compose ... logs api --tail=80)" >&2
  exit 1
fi
