#!/usr/bin/env bash
# Хуки Certbot (standalone на :80): освободить порт перед renew, вернуть SPA после.
# В renewal-конфиге Let’s Encrypt:
#   pre_hook  = /opt/fitnessApp/deploy/scripts/certrenew-docker-web.sh stop
#   post_hook = /opt/fitnessApp/deploy/scripts/certrenew-docker-web.sh start
#
# Переменные (опционально):
#   ENV_FILE — путь к env (по умолчанию deploy/.env.production)

set -euo pipefail

ACTION="${1:-}"
if [[ "$ACTION" != "stop" && "$ACTION" != "start" ]]; then
  echo "Использование: $0 stop|start" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет файла $ENV_FILE" >&2
  exit 1
fi

case "$ACTION" in
  stop)  "${COMPOSE[@]}" stop web ;;
  start) "${COMPOSE[@]}" start web ;;
esac
