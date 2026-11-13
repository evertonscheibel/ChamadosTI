#!/usr/bin/env bash
# Backup diário do atendimento do RH (rodado pelo timer frizelo-rh-backup, 03:30).
# Guarda 14 dias em /opt/backups/frizelo-rh. Não para nenhum serviço.
set -euo pipefail
cd /opt/apps/frizelo-rh
DEST=/opt/backups/frizelo-rh
STAMP=$(date +%Y%m%d-%H%M)
TMP="$DEST/.tmp-$STAMP"
umask 077
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# Central: cópia consistente do SQLite com o serviço no ar
docker compose exec -T central node -e "const {DatabaseSync}=require('node:sqlite');require('fs').rmSync('/app/data/.backup.sqlite',{force:true});new DatabaseSync('/app/data/central.sqlite').exec(\"VACUUM INTO '/app/data/.backup.sqlite'\")"
mv state/central-data/.backup.sqlite "$TMP/central.sqlite"
# Chatwoot: banco + anexos
docker compose exec -T postgres pg_dump -U chatwoot -Fc chatwoot > "$TMP/chatwoot.dump"
tar czf "$TMP/chatwoot-storage.tgz" -C state chatwoot-storage
# WhatsApp: sessão (evita ler o QR de novo numa restauração) e configuração
tar czf "$TMP/waha-sessions.tgz" -C state waha-sessions
cp .env central.env chatwoot.env waha.env compose.yaml "$TMP/"

tar cf "$DEST/frizelo-rh-$STAMP.tar" -C "$TMP" .
find "$DEST" -maxdepth 1 -name 'frizelo-rh-*.tar' -mtime +14 -delete
echo "Backup ok: $DEST/frizelo-rh-$STAMP.tar ($(du -h "$DEST/frizelo-rh-$STAMP.tar" | cut -f1))"
