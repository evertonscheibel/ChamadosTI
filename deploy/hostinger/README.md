# Hostinger - Central de Relacionamentos

Diretorio remoto: `/opt/apps/central-relacionamentos`.
Compose independente dos demais sistemas. Portas somente em loopback:
Evolution `18081`, WAHA Core `18082`. PostgreSQL e Redis sem portas publicadas.
Imagens fixadas por digest no `.env` remoto. Segredos criados somente na VPS,
arquivos modo 600 e diretorio modo 700; nao copiar para o Git.

## Operacao

```sh
cd /opt/apps/central-relacionamentos
docker compose ps
python3 check.py
python3 verify-backup.py
systemctl status central-health.timer central-health.service
./backup.sh
```

Backup diario local, retencao de 14 dias, em `/opt/backups/central-relacionamentos`.
O backup pausa apenas os dois provedores, faz pg_dump e copia arquivos/sessoes;
ha breve indisponibilidade das APIs durante essa janela (03:15 America/Cuiaba).
Redis e cache reconstruivel e nao integra o backup.
Uma copia externa e alertas fora do servidor ainda precisam ser configurados.
A verificacao periodica registra falhas no journal; nao envia notificacoes.
O restart automatico recupera processos encerrados; estado unhealthy por si so
nao reinicia containers. Reinicio completo da VPS nao e feito nesta preparacao.

## Restauracao

Em ambiente isolado, extrair o arquivo externo, depois `config-sessions.tar.gz`
no diretorio da aplicacao. Preservar permissoes e parar os provedores.
Iniciar PostgreSQL/Redis com `docker compose up -d postgres redis`.
Restaurar `evolution.dump` com `pg_restore -U evolution -d evolution --clean --if-exists`
via `docker compose exec -T postgres`. Iniciar provedores e executar `check.py`.
Nunca executar testes de restauracao sobre o banco ativo.

## Acesso administrativo

```powershell
ssh -N -L 18081:127.0.0.1:18081 -L 18082:127.0.0.1:18082 frizelo-vps
```

Dashboard e Swagger WAHA desabilitados. APIs exigem chaves dos arquivos privados.
Nao ha sessoes criadas, numero pareado ou webhooks de atendimento configurados.

## Proximas etapas

Publicar a Central exige dominio/HTTPS, contas reais em vez de demonstracao,
configuracao segura da Senior e integracoes entre sistemas. Os dados locais de
colaboradores nao sao enviados nesta preparacao. Selecionar provedor por numero,
parear WhatsApp e implementar/validar fluxo ponta a ponta antes de uso pelo RH.

## Validacao em 27/10/2026

Evolution 2.3.7 e WAHA Core instalados; consultas autenticadas responderam 200,
sem chave responderam 401, zero sessoes. Primeiro backup restaurado em banco
temporario: 37 tabelas, com verificacao do arquivo de configuracao e sessoes.
ATS respondeu 307 e Financeiro 302. Portal publico respondeu 525 antes da
criacao dos containers, com origem local respondendo 302; investigar TLS/DNS
separadamente. Nginx, DNS e sistemas existentes nao foram alterados.
