"""Run on the VPS, never prints credentials. Refuses to replace existing secrets."""
from pathlib import Path
import os
import secrets
import subprocess

root = Path('/opt/apps/central-relacionamentos')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(root, 0o700)
os.umask(0o077)
for name in ['postgres', 'redis', 'evolution', 'waha-sessions', 'waha-media', 'central']:
    (root / 'state' / name).mkdir(parents=True, exist_ok=True)

def write_new(name, text):
    path = root / name
    if path.exists():
        raise SystemExit(f'Refusing to overwrite {path}')
    path.write_text(text)
    path.chmod(0o600)

def digest(image):
    return subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{index .RepoDigests 0}}'], text=True).strip()

password = secrets.token_hex(32)
write_new('.env', '\n'.join([
    'POSTGRES_IMAGE=' + digest('postgres:16-alpine'),
    'REDIS_IMAGE=' + digest('redis:7-alpine'),
    'EVOLUTION_IMAGE=' + digest('evoapicloud/evolution-api:v2.3.7'),
    'WAHA_IMAGE=' + digest('devlikeapro/waha:latest'),
    'POSTGRES_PASSWORD=' + password, '',
]))
write_new('evolution.env', '\n'.join([
    'SERVER_TYPE=http', 'SERVER_PORT=8080', 'SERVER_URL=http://127.0.0.1:18081',
    'AUTHENTICATION_API_KEY=' + secrets.token_hex(32),
    'AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false',
    'DATABASE_PROVIDER=postgresql',
    f'DATABASE_CONNECTION_URI=postgresql://evolution:{password}@postgres:5432/evolution?schema=public',
    'DATABASE_CONNECTION_CLIENT_NAME=central_frizelo',
    'CACHE_REDIS_ENABLED=true', 'CACHE_REDIS_URI=redis://redis:6379/0',
    'CACHE_REDIS_PREFIX_KEY=central', 'CACHE_REDIS_SAVE_INSTANCES=false',
    'CACHE_LOCAL_ENABLED=false', 'TELEMETRY_ENABLED=false',
    'LOG_LEVEL=ERROR,WARN,LOG', 'LOG_BAILEYS=error',
    'WEBHOOK_GLOBAL_ENABLED=false', 'CORS_ORIGIN=*', 'CORS_CREDENTIALS=false',
    'TZ=America/Cuiaba', '',
]))
write_new('waha.env', '\n'.join([
    'WAHA_API_KEY=' + secrets.token_hex(32),
    'WAHA_DASHBOARD_ENABLED=false', 'WHATSAPP_SWAGGER_ENABLED=false',
    'WAHA_DASHBOARD_USERNAME=admin',
    'WAHA_DASHBOARD_PASSWORD=' + secrets.token_hex(32),
    'WHATSAPP_SWAGGER_USERNAME=admin',
    'WHATSAPP_SWAGGER_PASSWORD=' + secrets.token_hex(32),
    'WHATSAPP_DEFAULT_ENGINE=WEBJS', 'WAHA_LOG_LEVEL=warn',
    'TZ=America/Cuiaba', '',
]))
print('Private configuration created; images pinned by digest. No WhatsApp sessions created.')
