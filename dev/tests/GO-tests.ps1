[CmdletBinding()]
param(
    [switch]$SkipVulnerabilityScan
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$GoCache = Join-Path $RepoRoot '.codex-tmp\release-go-cache'
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

foreach ($command in @('go', 'gofmt')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] $command was not found on PATH." -ForegroundColor Red
        exit 1
    }
}

New-Item -ItemType Directory -Path $GoCache -Force | Out-Null
$env:GOCACHE = $GoCache

Push-Location $RepoRoot
try {
    Write-Host "Rockion Go checks - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Host (& go version)
    Write-Host

    $goFiles = @(
        Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Filter '*.go' |
            Where-Object {
                $_.FullName -notmatch '\\(\.git|frontend\\node_modules|frontend\\wailsjs|build|\.codex-tmp)\\'
            } |
            Select-Object -ExpandProperty FullName
    )

    Write-Host '[CHECK] Go formatting' -ForegroundColor Gray
    $unformatted = @(& gofmt -l $goFiles)
    if ($unformatted.Count -gt 0) {
        $Failures.Add('Go formatting')
        Write-Host '[FAIL] These files need gofmt:' -ForegroundColor Red
        $unformatted | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    } else {
        Write-Host '[OK] Go formatting' -ForegroundColor Green
    }

    Invoke-CheckedCommand 'Go module verification' { & go mod verify }
    Invoke-CheckedCommand 'Go tests' { & go test ./... }
    Invoke-CheckedCommand 'Go vet' { & go vet ./... }

    if ($SkipVulnerabilityScan) {
        Write-Host '[SKIP] Go vulnerability scan' -ForegroundColor Yellow
    } else {
        Invoke-CheckedCommand 'Go vulnerability scan' {
            & go run golang.org/x/vuln/cmd/govulncheck@v1.3.0 ./...
        }
    }
} finally {
    Pop-Location
}

Write-Host
if ($Failures.Count -gt 0) {
    Write-Host "RESULT: FAIL ($($Failures.Count) check(s))" -ForegroundColor Red
    exit 1
}

Write-Host 'RESULT: PASS' -ForegroundColor Green
