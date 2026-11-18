#!/bin/bash
# Grava a senha do e-mail (SMTP) da Central sem mostrar na tela e reinicia a Central.
set -euo pipefail
cd /opt/apps/frizelo-rh
read -rsp "Senha do e-mail (SMTP): " P; echo
echo "caracteres: ${#P}"
if [ -z "$P" ]; then echo "Nada gravado. Rode de novo."; exit 1; fi
printf '%s' "$P" > smtp-pass.txt
unset P
chown 1000:1000 smtp-pass.txt; chmod 400 smtp-pass.txt
docker compose up -d --no-deps --force-recreate central
echo "Senha gravada e Central reiniciada."
