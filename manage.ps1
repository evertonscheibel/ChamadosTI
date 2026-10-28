param([ValidateSet('Start','Stop','Status')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$pidFile = Join-Path $repo 'service.pid.local'
$server = Join-Path $repo 'scripts\serve.mjs'
$running = $null
if (Test-Path $pidFile) {
  $serviceId = [int](Get-Content $pidFile)
  $running = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId" | Where-Object { $_.CommandLine -like "*$server*" }
}
switch ($Action) {
  'Start' {
    if ($running) { Write-Output "Already running: PID $($running.ProcessId)"; break }
    if (Get-NetTCPConnection -LocalPort 45873 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 45873 is already occupied.' }
    if (!(Test-Path (Join-Path $repo 'dist\index.html'))) { throw 'Run npm run build first.' }
    New-Item -ItemType Directory -Path (Join-Path $repo 'logs') -Force | Out-Null
    $proc = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + $server + '"') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo 'logs\server.log') -RedirectStandardError (Join-Path $repo 'logs\server-error.log') -PassThru
    $proc.Id | Set-Content $pidFile
    Write-Output "Started PID $($proc.Id): http://127.0.0.1:45873"
  }
  'Stop' {
    if ($running) { Stop-Process -Id $running.ProcessId; Write-Output 'Central Frizelo encerrada.' }
    if (Test-Path $pidFile) { Remove-Item -LiteralPath $pidFile }
  }
  'Status' {
    if ($running) { Invoke-RestMethod http://127.0.0.1:45873/health | ConvertTo-Json } else { Write-Output 'Stopped' }
  }
}
