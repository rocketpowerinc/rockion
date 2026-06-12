[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$FrontendDir = Join-Path $RepoRoot 'frontend'
$Failures = [System.Collections.Generic.List[string]]::new()

function Invoke-CheckedCommand {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host "[CHECK] $Name" -ForegroundColor Gray
    & $Command
    if ($LASTEXITCODE -ne 0) {
        $Failures.Add($Name)
        Write-Host "[FAIL] $Name" -ForegroundColor Red
    } else {
        Write-Host "[OK] $Name" -ForegroundColor Green
    }
}

foreach ($command in @('node', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] $command was not found on PATH." -ForegroundColor Red
        exit 1
    }
}

Push-Location $FrontendDir
try {
    Write-Host "Rockion frontend checks - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Host "Node $(& node --version), npm $(& npm --version)"
    Write-Host

    if ($SkipInstall) {
        Write-Host '[SKIP] npm ci' -ForegroundColor Yellow
    } else {
        Invoke-CheckedCommand 'Reproducible dependency install' { & npm ci }
    }

    Invoke-CheckedCommand 'Full dependency audit' {
        & npm audit --audit-level=moderate
    }
    Invoke-CheckedCommand 'Frontend production build' { & npm run build }
} finally {
    Pop-Location
}

Write-Host
if ($Failures.Count -gt 0) {
    Write-Host "RESULT: FAIL ($($Failures.Count) check(s))" -ForegroundColor Red
    exit 1
}

Write-Host 'RESULT: PASS' -ForegroundColor Green
