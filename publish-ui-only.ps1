param(
    [string]$LiveTreeUrl = "https://cbfitzpatrick.github.io/yjmb-family-tree/data/tree_data.enc",
    [switch]$UseLocalEncryptedTree
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Template = Join-Path $Root "web_template"
$Docs = Join-Path $Root "docs"
$DataDir = Join-Path $Docs "data"
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Template)) { throw "web_template folder not found at $Template" }
if (-not (Test-Path $Docs)) { New-Item -ItemType Directory -Path $Docs | Out-Null }
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

$TreePath = Join-Path $DataDir "tree_data.enc"
$TempTree = Join-Path ([System.IO.Path]::GetTempPath()) ("yjmb_tree_" + [guid]::NewGuid().ToString("N") + ".enc")

try {
    if ($UseLocalEncryptedTree) {
        if (-not (Test-Path $TreePath)) {
            throw "-UseLocalEncryptedTree was selected, but $TreePath does not exist."
        }
        Copy-Item $TreePath $TempTree -Force
        Write-Host "Preserving local encrypted tree payload." -ForegroundColor Cyan
    }
    else {
        Write-Host "Retrieving the currently deployed encrypted tree payload..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $LiveTreeUrl -OutFile $TempTree -UseBasicParsing
    }

    $Envelope = Get-Content $TempTree -Raw | ConvertFrom-Json
    if ($Envelope.format -ne "yjmb-tree-encrypted-v3" -or -not $Envelope.ciphertext) {
        throw "The preserved tree file is not a valid YJMB encrypted tree payload. UI-only publish was stopped."
    }

    $UiFiles = @(
        "index.html", "gate-2.html", "gate-3.html", "loading.html",
        "tree.html", "correction.html", "add-yourself.html", "admin.html",
        "styles.css", "gate.css", "gate.js", "secure-data.js",
        "developer-export.js", "app.js", "correction.js", "add-yourself.js",
        "admin.js", "admin-mail.js", "rat-parent-icon.png", "section-leader-icon.png", "band-club-icon.png", "site_config.json"
    )
    foreach ($Name in $UiFiles) {
        $Source = Join-Path $Template $Name
        if (-not (Test-Path $Source)) { throw "Required UI file is missing: $Source" }
        Copy-Item $Source (Join-Path $Docs $Name) -Force
    }
    New-Item -ItemType File -Path (Join-Path $Docs ".nojekyll") -Force | Out-Null

    # The defining safety property of this command: the encrypted tree bytes are
    # restored from the already-deployed (or explicitly selected local) bundle,
    # never regenerated from YJMB Trees.xlsx.
    Copy-Item $TempTree $TreePath -Force

    if (Test-Path (Join-Path $DataDir "tree_data.json")) {
        Remove-Item (Join-Path $DataDir "tree_data.json") -Force
    }
    if (Test-Path (Join-Path $Docs "assets\cards")) {
        Remove-Item (Join-Path $Docs "assets\cards") -Recurse -Force
    }

    if (Test-Path $Python) {
        & $Python ".\verify_public_repo.py"
        if ($LASTEXITCODE -ne 0) { throw "verify_public_repo.py failed. Nothing should be staged until the issue is resolved." }
    }
    else {
        Write-Warning "Virtual-environment Python was not found, so verify_public_repo.py was not run automatically. Run it manually before git add."
    }

    Write-Host "" 
    Write-Host "UI-only GitHub Pages files are ready in .\docs." -ForegroundColor Green
    Write-Host "The deployed encrypted tree payload was preserved; the workbook and secure/master_workbook.enc were not touched." -ForegroundColor Green
}
finally {
    Remove-Item $TempTree -Force -ErrorAction SilentlyContinue
}
