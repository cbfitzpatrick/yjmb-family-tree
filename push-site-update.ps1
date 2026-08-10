param(
    [string]$Message = "Update YJMB tree data",
    [switch]$SkipAmbiguities
)

$ErrorActionPreference = "Stop"

$Project = "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"

Set-Location $Project

Write-Host "`n=== Activating Python environment ==="
& ".\.venv\Scripts\Activate.ps1"

Write-Host "`n=== Rebuilding encrypted website ==="
if ($SkipAmbiguities) {
    & ".\build-site.ps1" -SkipAmbiguities
}
else {
    & ".\build-site.ps1"
}

Write-Host "`n=== Running public-repository privacy audit ==="
python ".\verify_public_repo.py"

if ($LASTEXITCODE -ne 0) {
    throw "Privacy verification failed. Nothing will be pushed."
}

Write-Host "`n=== Git status ==="
git status --short

Write-Host "`n=== Staging changes ==="
git add .

Write-Host "`n=== Re-running privacy audit against staged files ==="
python ".\verify_public_repo.py"

if ($LASTEXITCODE -ne 0) {
    Write-Host "`nPrivacy check failed after staging. Unstaging files..."
    git restore --staged .
    throw "Push aborted."
}

$Changes = git diff --cached --name-only

if (-not $Changes) {
    Write-Host "`nNo changes to commit."
    exit 0
}

Write-Host "`nFiles being committed:"
$Changes | ForEach-Object {
    Write-Host "  $_"
}

Write-Host "`n=== Creating commit ==="
git commit -m $Message

Write-Host "`n=== Pushing to GitHub ==="
git push

Write-Host "`n============================================"
Write-Host "Update pushed successfully."
Write-Host "GitHub Actions should now redeploy the site."
Write-Host "============================================"