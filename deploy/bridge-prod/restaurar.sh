#!/usr/bin/env bash
# Roda NO SERVIDOR, em /opt/apps/frizelo-rh, com os arquivos exportados em ./incoming.
#   ./restaurar.sh ensaio   sobe tudo menos o WAHA; a central fica sem avisos/recuperação (não fala com ninguém)
#   ./restaurar.sh final    sobe tudo, com a sessão do WhatsApp e o app do Chatwoot no WAHA
set -euo pipefail
MODE=${1:?ensaio|final}
cd /opt/apps/frizelo-rh
IN=./incoming
dc() { docker compose "$@"; }
psqlc() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -U chatwoot "$@"; }

echo "== Código da central"
rm -rf release && mkdir release && tar xzf "$IN/release.tgz" -C release
dc build central

echo "== Parando o que estiver rodando"
docker rm -f frizelo-rh-central-ensaio >/dev/null 2>&1 || true
dc stop central waha sidekiq chatwoot 2>/dev/null || true

echo "== Banco do Chatwoot"
dc up -d postgres redis
until dc exec -T postgres pg_isready -U chatwoot -d chatwoot >/dev/null 2>&1; do sleep 2; done
psqlc -d postgres -c "DROP DATABASE IF EXISTS chatwoot WITH (FORCE)" -c "CREATE DATABASE chatwoot OWNER chatwoot"
dc exec -T postgres pg_restore -U chatwoot -d chatwoot --no-owner --role=chatwoot < "$IN/chatwoot.dump"
# Endereços da homologação -> endereços internos do servidor
psqlc -d chatwoot \
  -c "UPDATE agent_bots SET outgoing_url='http://central:45873/api/chatwoot/webhook' WHERE outgoing_url LIKE '%/api/chatwoot/webhook'" \
  -c "UPDATE channel_api SET webhook_url=regexp_replace(webhook_url, '^https?://[^/]+', 'http://waha:3000') WHERE webhook_url LIKE '%/webhooks/chatwoot/%'"

echo "== Anexos do Chatwoot"
rm -rf state/chatwoot-storage && mkdir -p state/chatwoot-storage
tar xzf "$IN/chatwoot-storage.tgz" -C state/chatwoot-storage --strip-components=1
chown -R 1000:1000 state/chatwoot-storage 2>/dev/null || true

echo "== Banco da central"
chown 1000:1000 central.env && chmod 600 central.env   # a central roda como usuário node (uid 1000)
mkdir -p state/central-data
rm -f state/central-data/central.sqlite-wal state/central-data/central.sqlite-shm
cp "$IN/central.sqlite" state/central-data/central.sqlite
chown -R 1000:1000 state/central-data

echo "== Chatwoot"
dc run --rm chatwoot bundle exec rails db:migrate
dc up -d chatwoot sidekiq

if [ "$MODE" = final ]; then
  echo "== WhatsApp (sessão + app)"
  rm -rf state/waha-sessions && mkdir -p state/waha-sessions
  tar xzf "$IN/waha-sessions.tgz" -C state/waha-sessions
  dc up -d waha
  KEY=$(grep '^WAHA_API_KEY=' waha.env | cut -d= -f2-)
  for i in $(seq 1 60); do curl -fsS -H "X-Api-Key: $KEY" http://127.0.0.1:3102/api/sessions >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS -X POST -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' --data @"$IN/waha-app.json" http://127.0.0.1:3102/api/apps >/dev/null \
    || curl -fsS -X PUT -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' --data @"$IN/waha-app.json" "http://127.0.0.1:3102/api/apps/$(sed -E 's/.*"id":"([^"]+)".*/\1/' "$IN/waha-app.json")" >/dev/null
  dc up -d central
else
  echo "== Central em modo ensaio (sem avisos, sem recuperação, sem vigia do WhatsApp)"
  dc run -d --no-deps --name frizelo-rh-central-ensaio --service-ports -e CENTRAL_AVISOS=off -e WAHA_WATCHDOG=off central
fi
dc ps
