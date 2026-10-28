"""Read-only health/auth checks. Does not print keys or response data."""
from pathlib import Path
import json
import urllib.request
import urllib.error

root = Path('/opt/apps/central-relacionamentos')
def env(name):
    return dict(line.split('=', 1) for line in (root / name).read_text().splitlines() if '=' in line and not line.startswith('#'))

def request(url, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError):
        return 0, None

for name, port, path, header, key in [
    ('evolution',18081,'/instance/fetchInstances','apikey','AUTHENTICATION_API_KEY'),
    ('waha',18082,'/api/sessions','X-Api-Key','WAHA_API_KEY'),
]:
    config = env(name + '.env')
    url = f'http://127.0.0.1:{port}{path}'
    anonymous, _ = request(url, {})
    authorized, body = request(url, {header: config[key]})
    count = len(body) if isinstance(body, list) else 'unknown'
    print(f'{name}: anonymous={anonymous} authenticated={authorized} sessions={count}')
    if anonymous not in (401,403) or authorized != 200:
        raise SystemExit(1)
