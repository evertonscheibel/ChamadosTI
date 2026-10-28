from pathlib import Path
import subprocess

root = Path('/opt/apps/central-relacionamentos')
for filename in ['central-health.service', 'central-health.timer']:
    target = Path('/etc/systemd/system') / filename
    if target.exists():
        raise SystemExit(f'Refusing to replace {target}')
    target.write_bytes((root / filename).read_bytes())
    target.chmod(0o644)
cron = Path('/etc/cron.d/frizelo-central-backup')
if cron.exists():
    raise SystemExit('Backup cron already exists')
# Host timezone verified as UTC. 07:15 UTC = 03:15 America/Cuiaba.
cron.write_text('SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n15 7 * * * root /opt/apps/central-relacionamentos/backup.sh >> /var/log/frizelo-central-backup.log 2>&1\n')
cron.chmod(0o644)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'central-health.timer'], check=True)
print('Daily backup at 03:15 Cuiaba and health timer installed.')
