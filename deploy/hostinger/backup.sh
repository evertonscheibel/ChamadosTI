#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/lock/frizelo-central-backup.lock
flock -n 9 || exit 0
cd /opt/apps/central-relacionamentos
target=/opt/backups/central-relacionamentos
mkdir -p "$target"
chmod 700 "$target"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp=$(mktemp -d "$target/.backup-XXXXXX")
resume() { docker compose start evolution waha >/dev/null; }
cleanup() { resume; rm -rf -- "$tmp"; }
trap cleanup EXIT
docker compose stop -t 30 evolution waha >/dev/null
docker compose exec -T postgres pg_dump -U evolution -d evolution -Fc > "$tmp/evolution.dump"
tar -czf "$tmp/config-sessions.tar.gz" compose.yaml .env evolution.env waha.env state/evolution state/waha-sessions state/waha-media state/central
resume
tar -czf "$target/$stamp.tar.gz" -C "$tmp" evolution.dump config-sessions.tar.gz
tar -tzf "$target/$stamp.tar.gz" >/dev/null
find "$target" -maxdepth 1 -type f -name '*.tar.gz' -mtime +14 -delete
echo "Backup completed: $stamp"
