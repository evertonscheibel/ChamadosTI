#!/bin/bash
# Backup diário do frizelo-rh (timer frizelo-rh-backup.timer, 03:30).
# O arquivo final é cifrado com age (chave pública em backup-recipient.txt).
# A chave privada NÃO fica neste servidor: está em D:\Backups\bridge-prod\CHAVE no PC 10.1.1.231.
# Para abrir: age -d -i frizelo-rh-backup.age-key.txt -o backup.tar frizelo-rh-AAAAMMDD-HHMM.tar.age
set -euo pipefail
cd /opt/apps/frizelo-rh
DEST=/opt/backups/frizelo-rh
STAMP=$(date +%Y%m%d-%H%M)
TMP="$DEST/.tmp-$STAMP"
RECIPIENTS=/opt/apps/frizelo-rh/backup-recipient.txt
umask 077
mkdir -p "$TMP"
# Situação para a Central (alerta da TI): "erro" se qualquer passo falhar, "ok" + data no fim.
STATUS=/opt/apps/frizelo-rh/state/central-data/backup-status.json
LAST_OK=$(grep -o '"lastOk":"[^"]*"' "$STATUS" 2>/dev/null | cut -d'"' -f4 || true)
status() { printf '{"result":"%s","at":"%s","lastOk":"%s"}\n' "$1" "$(date -Iseconds)" "$2" > "$STATUS.tmp" && chmod 644 "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"; }
trap 'rc=$?; rm -rf "$TMP"; [ $rc -ne 0 ] && status erro "$LAST_OK"; exit $rc' EXIT
docker compose exec -T central node -e "const {DatabaseSync}=require('node:sqlite');require('fs').rmSync('/app/data/.backup.sqlite',{force:true});new DatabaseSync('/app/data/central.sqlite').exec(\"VACUUM INTO '/app/data/.backup.sqlite'\")"
mv state/central-data/.backup.sqlite "$TMP/central.sqlite"
docker compose exec -T postgres pg_dump -U chatwoot -Fc chatwoot > "$TMP/chatwoot.dump"
tar czf "$TMP/chatwoot-storage.tgz" -C state chatwoot-storage
tar czf "$TMP/waha-sessions.tgz" -C state waha-sessions
cp .env central.env chatwoot.env waha.env compose.yaml "$TMP/"
OUT="$DEST/frizelo-rh-$STAMP.tar.age"
tar cf - -C "$TMP" --exclude=./out . | age -R "$RECIPIENTS" -o "$OUT.parcial"
mv "$OUT.parcial" "$OUT"
find "$DEST" -maxdepth 1 \( -name 'frizelo-rh-*.tar.age' -o -name 'frizelo-rh-*.tar' \) -mtime +14 -delete
status ok "$(date -Iseconds)"
echo "Backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
