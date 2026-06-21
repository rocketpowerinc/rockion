[CmdletBinding()]
param(
    [switch]$SkipVulnerabilityScan
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$GoCache = Join-Path $RepoRoot '.codex-tmp\release-go-cache'
$GoPath = Join-Path $RepoRoot '.codex-tmp\release-go-path'
$Failures = [System.Collections.Generic.List[string]]::new()

function Resolve-Tool {
    param(
        [string]$Name,
        [string[]]$Fallbacks = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    foreach ($fallback in $Fallbacks) {
        if ($fallback -and (Test-Path -LiteralPath $fallback)) {
            return $fallback
        }
    }
    return $null
}

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

$GoCommand = Resolve-Tool 'go' @(
    'C:\Program Files\Go\bin\go.exe',
    'C:\Program Files (x86)\Go\bin\go.exe'
)
$GofmtCommand = Resolve-Tool 'gofmt' @(
    'C:\Program Files\Go\bin\gofmt.exe',
    'C:\Program Files (x86)\Go\bin\gofmt.exe'
)

if (-not $GoCommand) {
    Write-Host '[ERROR] go was not found on PATH or in the standard Windows install location.' -ForegroundColor Red
    Write-Host '        Install Go, then reopen PowerShell or rerun this script.' -ForegroundColor DarkGray
    exit 1
}
if (-not $GofmtCommand) {
    Write-Host '[ERROR] gofmt was not found on PATH or in the standard Windows install location.' -ForegroundColor Red
    exit 1
}

$goBin = Split-Path -Parent $GoCommand
if ($env:Path -notlike "*$goBin*") {
    $env:Path = "$goBin;$env:Path"
}

New-Item -ItemType Directory -Path $GoCache -Force | Out-Null
New-Item -ItemType Directory -Path $GoPath -Force | Out-Null
$env:GOCACHE = $GoCache
$env:GOPATH = $GoPath
$env:GOMODCACHE = Join-Path $GoPath 'pkg\mod'

Push-Location $RepoRoot
try {
    Write-Host "Rockion Go checks - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Host (& $GoCommand version)
    Write-Host "Go build cache: $env:GOCACHE" -ForegroundColor DarkGray
    Write-Host "Go module cache: $env:GOMODCACHE" -ForegroundColor DarkGray
    Write-Host 'First run may download Go modules into the repository-local cache.' -ForegroundColor DarkGray
    Write-Host

    $goFiles = @(
        Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Filter '*.go' |
            Where-Object {
                $_.FullName -notmatch '\\(\.git|frontend\\node_modules|frontend\\wailsjs|build|\.codex-tmp)\\'
            } |
            Select-Object -ExpandProperty FullName
    )

    Write-Host '[CHECK] Go formatting' -ForegroundColor Gray
    $unformatted = @(& $GofmtCommand -l $goFiles)
    if ($unformatted.Count -gt 0) {
        $Failures.Add('Go formatting')
        Write-Host '[FAIL] These files need gofmt:' -ForegroundColor Red
        $unformatted | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    } else {
        Write-Host '[OK] Go formatting' -ForegroundColor Green
    }

    Invoke-CheckedCommand 'Go module verification' { & $GoCommand mod verify }
    Invoke-CheckedCommand 'Go tests' { & $GoCommand test ./... }
    Invoke-CheckedCommand 'Go vet' { & $GoCommand vet ./... }

    if ($SkipVulnerabilityScan) {
        Write-Host '[SKIP] Go vulnerability scan' -ForegroundColor Yellow
    } else {
        Invoke-CheckedCommand 'Go vulnerability scan' {
            & $GoCommand run golang.org/x/vuln/cmd/govulncheck@v1.3.0 ./...
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
