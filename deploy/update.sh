#!/usr/bin/env bash
# Neue Fassung einspielen (auf dem Server, im Ordner /opt/marble-web):  sudo deploy/update.sh
# Holt den Stand aus git (oder nimmt den ausgepackten Quellcode), baut und startet neu. Datenbank bleibt.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .git ]; then sudo -u marble-web git pull --ff-only; fi
sudo -u marble-web npm ci --no-audit --no-fund
sudo -u marble-web npm run build
sudo -u marble-web npm prune --omit=dev --no-audit --no-fund
systemctl restart marble-web
sleep 2
systemctl --no-pager --lines=5 status marble-web
curl -fsS http://127.0.0.1:5310/api/config | head -c 200; echo
