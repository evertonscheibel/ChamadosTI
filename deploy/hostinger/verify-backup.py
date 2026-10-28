"""Restore the latest dump into a temporary isolated database; never overwrite live DB."""
from pathlib import Path
import subprocess
import tarfile
import tempfile
import secrets

root = Path('/opt/apps/central-relacionamentos')
archive = sorted(Path('/opt/backups/central-relacionamentos').glob('*.tar.gz'))[-1]
base = ['docker', 'compose', 'exec', '-T', 'postgres']
db = 'restore_check_' + secrets.token_hex(6)
def run(args, **kwargs):
    return subprocess.run(base + args, cwd=root, check=True, **kwargs)
with tarfile.open(archive) as outer, tempfile.TemporaryFile() as dump:
    source = outer.extractfile('evolution.dump')
    dump.write(source.read())
    dump.seek(0)
    run(['createdb', '-U', 'evolution', db])
    try:
        run(['pg_restore', '-U', 'evolution', '-d', db, '--exit-on-error', '--no-owner'], stdin=dump)
        result = subprocess.check_output(base + ['psql', '-U', 'evolution', '-d', db, '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], cwd=root, text=True).strip()
        if int(result) < 1:
            raise SystemExit('Restore has no tables')
        with outer.extractfile('config-sessions.tar.gz') as content, tarfile.open(fileobj=content, mode='r|gz') as inner:
            names = [member.name for member in inner]
            assert 'evolution.env' in names and 'state/waha-sessions' in names
        print(f'Backup restore OK: {result} public tables; config/session archive OK.')
    finally:
        run(['dropdb', '-U', 'evolution', db])
