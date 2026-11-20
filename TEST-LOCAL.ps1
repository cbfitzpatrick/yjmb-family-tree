param(
    [int]$Port = 8765,
    [switch]$UsePrivateTree
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'py' }
$PreviewArgs = @((Join-Path $Root 'tools\local_preview_server.py'), '--port', "$Port")
if ($UsePrivateTree) { $PreviewArgs += '--real-data' }
Write-Host 'Local-only preview. No site upload or GitHub push.' -ForegroundColor Cyan
& $Python @PreviewArgs
