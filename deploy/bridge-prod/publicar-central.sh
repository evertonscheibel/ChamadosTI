#!/bin/sh
# Roda NO SERVIDOR, em /opt/apps/frizelo-rh: publica a central (serviço "central" do compose)
# a partir de ./release. Gera a imagem frizelo-rh-central:AAAAMMDD-HHMM e troca o container;
# se a nova não ficar saudável em 90 s, volta para a imagem anterior.
set -eu
cd /opt/apps/frizelo-rh
TAG=$(date +%Y%m%d-%H%M)
ANTIGA=$(grep '^CENTRAL_TAG=' .env | cut -d= -f2-)

echo "== build frizelo-rh-central:$TAG (anterior: $ANTIGA)"
docker build -q -f Dockerfile.central -t "frizelo-rh-central:$TAG" release >/dev/null

saudavel() {
  for i in $(seq 1 30); do
    s=$(docker inspect frizelo-rh-central-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo none)
    [ "$s" = healthy ] && return 0
    sleep 3
  done
  echo "estado: $s"
  return 1
}

sed -i "s#^CENTRAL_TAG=.*#CENTRAL_TAG=$TAG#" .env
docker compose up -d --no-deps central >/dev/null 2>&1
if saudavel; then
  echo "OK: central rodando frizelo-rh-central:$TAG (saudável). Imagem anterior mantida: $ANTIGA"
else
  echo "FALHOU: voltando para $ANTIGA"
  docker compose logs --tail 20 central 2>&1 || true
  sed -i "s#^CENTRAL_TAG=.*#CENTRAL_TAG=$ANTIGA#" .env
  docker compose up -d --no-deps central >/dev/null 2>&1
  saudavel && echo "Voltou para $ANTIGA."
  exit 1
fi
