#!/usr/bin/env bash
# deploy_hook для Certbot: подхватить обновлённые PEM без рестарта nginx.
# В /etc/letsencrypt/renewal/*.conf в [renewalparams]:
#   deploy_hook = /opt/fitnessApp/deploy/scripts/certrenew-reload-nginx.sh
#
# Запускается от root при успешном renew (не при --dry-run).

set -euo pipefail
nginx -t
systemctl reload nginx
