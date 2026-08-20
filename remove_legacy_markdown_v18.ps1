param(
    [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $ProjectPath).Path
Push-Location $root
try {
    if (-not (Test-Path ".git")) {
        throw "Run this script from the YJMB Git repository, or pass -ProjectPath to the repository root."
    }

    $trackedMarkdown = @(git ls-files "*.md")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect tracked Markdown files."
    }

    $toRemove = @($trackedMarkdown | Where-Object {
        $normalized = ($_ -replace '\\', '/')
        $normalized -ne "README.md"
    })

    if ($toRemove.Count -eq 0) {
        Write-Host "No tracked Markdown files other than README.md were found." -ForegroundColor Green
        return
    }

    Write-Host "Removing tracked public Markdown files except README.md:" -ForegroundColor Cyan
    foreach ($path in $toRemove) {
        Write-Host "  $path"
        git rm -- "$path"
        if ($LASTEXITCODE -ne 0) { throw "git rm failed for $path" }
    }

    Write-Host "Markdown cleanup staged. Review with git status before committing." -ForegroundColor Green
}
finally {
    Pop-Location
}
