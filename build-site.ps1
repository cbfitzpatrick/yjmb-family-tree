param(
    [switch]$SkipAmbiguities
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "Virtual environment Python not found at $Python. Create .venv and install requirements.txt first."
}

# Creates cryptographic keys only when missing; preserves existing values.
& $Python ".\initialize_security.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$GeneratorArgs = @(
    ".\fullBandTreeGenerator.py",
    "--output-mode", "giant",
    "--skip-png",
    "--skip-svg",
    "--no-save-cards"
)
if ($SkipAmbiguities) { $GeneratorArgs += "--skip-ambiguities" }

& $Python @GeneratorArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# The GitHub Actions update path uses an encrypted copy of the workbook. The
# plaintext workbook remains local and gitignored.
& $Python ".\secure_workbook.py" encrypt --input ".\YJMB Trees.xlsx" --output ".\secure\master_workbook.enc"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $Python ".\verify_public_repo.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Encrypted GitHub Pages build is ready in .\docs" -ForegroundColor Green
Write-Host "Encrypted master workbook is ready at .\secure\master_workbook.enc" -ForegroundColor Green
