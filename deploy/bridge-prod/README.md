# Atendimento do RH — produção no bridge-prod (10.1.1.53)

Tudo em `/opt/apps/frizelo-rh`, separado dos outros sistemas do servidor.
Containers: `postgres` e `redis` (do Chatwoot), `chatwoot`, `sidekiq`, `waha` (WhatsApp) e `central`.

| Acesso | Endereço | Quem |
|---|---|---|
| Central do RH | http://10.1.1.53:45873 | equipe do RH (rede 10.1.1.0/24) |
| Chatwoot (administração) | http://10.1.1.53:3100 | TI |

O Docker só publica portas em 127.0.0.1. O nginx do servidor expõe as portas 45873 e 3100, e o ufw libera essas portas só para a rede interna.
Os segredos ficam em `.env`, `central.env`, `chatwoot.env` e `waha.env` (modo 600), gerados por `gerar-env.mjs` e nunca versionados.
A Senior usa o mesmo `.env` do `senior-hcm-connector` do servidor, montado só para leitura.
As contas de demonstração ficam bloqueadas (`CENTRAL_DEMO=off`).

## Operação

```sh
cd /opt/apps/frizelo-rh
docker compose ps
docker compose logs -f central        # ou waha, chatwoot, sidekiq
docker compose restart central
systemctl list-timers frizelo-rh-backup.timer
./backup.sh                           # backup manual
```

Backup diário às 03:30, guardado por 14 dias em `/opt/backups/frizelo-rh`. Inclui o banco da central, o banco e os anexos do Chatwoot, a sessão do WhatsApp e as configurações.
Ainda falta uma cópia fora do servidor.

## Ensaio (sem parar a homologação)

1. Neste PC, rode `exportar-local.sh ensaio <pasta>` e `node gerar-env.mjs <pasta>`.
2. Copie a pasta para `/opt/apps/frizelo-rh/incoming` e os `*.env` para `/opt/apps/frizelo-rh`.
3. No servidor, rode `./restaurar.sh ensaio`. Isso sobe o Chatwoot com os dados e a central sem WhatsApp, sem avisos e sem recuperação.

## Virada (fora do expediente; o WhatsApp fica 20 a 30 minutos sem resposta)

1. Exporte o app do WAHA com o WAHA local ainda ligado: `node exportar-app-waha.mjs <pasta>`.
2. Pare tudo neste PC:
   - a central;
   - o WAHA, com `docker stop waha` e `docker update --restart=no waha`;
   - o Chatwoot local, com `docker stop chatwoot-src-rails-1 chatwoot-src-sidekiq-1`.
3. Exporte os dados com `exportar-local.sh final <pasta>` e copie a pasta para `incoming/`.
4. No servidor, rode `./restaurar.sh final`. Isso restaura os dados, sobe o WAHA com a mesma sessão (não precisa ler o QR) e recria o app do Chatwoot.
5. Confira:
   - a sessão `default` está WORKING;
   - a central responde em http://10.1.1.53:45873;
   - uma mensagem do celular de teste abre ou complementa um chamado;
   - a resposta do RH chega no celular.
6. **Volta atrás, se der errado:** `docker compose stop waha central` no servidor. Depois religue o WAHA (`docker start waha`), o Chatwoot e a central neste PC.

**Nunca deixe os dois WAHA ligados com a mesma sessão.**
