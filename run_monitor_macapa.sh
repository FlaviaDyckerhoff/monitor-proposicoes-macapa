#!/usr/bin/env bash
set -euo pipefail

cd /root/.openclaw/workspace
set -a
. agents/proposicoes/.env
set +a

cd projects/monitor-proposicoes-macapa

git config user.name "Monitor Legislativo"
git config user.email "alertas@monitorlegislativo.com.br"

# Macapa roda no VPS porque o portal bloqueia GitHub runner. O estado precisa
# ficar sincronizado com o GitHub para evitar baseline divergente entre runs.
git fetch origin main
git rebase origin/main

export CONTROLE03_STATE_URL="${CONTROLE03_STATE_URL:-http://127.0.0.1:5017/controle03/api/state}"
export CONTROLE03_BASIC_AUTH="${CONTROLE03_BASIC_AUTH:-Basic controle03bot}"
node monitor.js
git add estado.json
git diff --cached --quiet || git commit -m "Atualiza estado"

git fetch origin main
git rebase origin/main
git push origin HEAD:main
