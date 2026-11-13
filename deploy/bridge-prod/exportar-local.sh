#!/usr/bin/env bash
# Exporta da homologação (este PC) o que vai para o servidor.
#   ./exportar-local.sh ensaio <pasta>   cópia "a quente", sem a sessão do WhatsApp (nada para aqui)
#   ./exportar-local.sh final  <pasta>   com central, WAHA e Chatwoot PARADOS: inclui a sessão do WhatsApp
set -euo pipefail
MODE=${1:?ensaio|final}
OUT=${2:?pasta de saída}
ROOT=/c/IA/ChamadosTI
mkdir -p "$OUT"
# Caminhos no formato do Windows para o Node (Git Bash)
win() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

echo "1/5 Código da central (build)"
(cd "$ROOT" && npm run build >/dev/null && tar czf "$OUT/release.tgz" package.json package-lock.json central scripts dist)

echo "2/5 Banco da central (cópia consistente)"
rm -f "$OUT/central.sqlite"
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('$(win "$ROOT")/data/central.sqlite').exec(\"VACUUM INTO '$(win "$OUT")/central.sqlite'\")"

echo "3/5 Banco do Chatwoot"
docker exec chatwoot-src-postgres-1 pg_dump -U postgres -Fc chatwoot > "$OUT/chatwoot.dump"

echo "4/5 Arquivos do Chatwoot (anexos)"
tar czf "$OUT/chatwoot-storage.tgz" -C /c/IA/chatwoot-src storage

if [ "$MODE" = final ]; then
  echo "5/5 Sessão do WhatsApp e configuração do app do WAHA"
  if [ "$(docker inspect -f '{{.State.Running}}' waha)" = true ]; then echo "Pare o WAHA antes (docker stop waha)."; exit 1; fi
  docker run --rm -v waha_sessions:/s:ro alpine tar czf - -C /s . > "$OUT/waha-sessions.tgz"
else
  echo "5/5 (ensaio: sessão do WhatsApp não é copiada)"
fi
ls -la "$OUT"
