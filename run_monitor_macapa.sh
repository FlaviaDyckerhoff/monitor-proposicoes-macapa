#!/usr/bin/env bash
set -euo pipefail

cd /root/.openclaw/workspace
set -a
. agents/proposicoes/.env
set +a

cd projects/monitor-proposicoes-macapa
node monitor.js
git add estado.json
git diff --cached --quiet || git commit -m "Atualiza estado"
git push || true
