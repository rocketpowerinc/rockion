[CmdletBinding()]
param(
    [switch]$KeepExisting
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$GoCache = Join-Path $RepoRoot '.codex-tmp\wails-go-cache'
$RockionDevPath = Join-Path $RepoRoot 'build\bin\rockion-dev.exe'

function Stop-RockionDevelopmentProcesses {
    $repoPattern = [regex]::Escape($RepoRoot)
    $processes = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                ($_.ExecutablePath -and
                    $_.ExecutablePath.Equals(
                        $RockionDevPath,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )) -or
                ($_.Name -in @('node.exe', 'wails.exe') -and
                    $_.CommandLine -match $repoPattern)
            }
    )
    if ($processes.Count -eq 0) {
        return
    }

    Write-Host '[INFO] Stopping an existing Rockion development session...' -ForegroundColor Yellow
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

foreach ($command in @('go', 'node', 'npm', 'wails')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] $command was not found on PATH." -ForegroundColor Red
        exit 1
    }
}

if (-not $KeepExisting) {
    Stop-RockionDevelopmentProcesses
}

New-Item -ItemType Directory -Path $GoCache -Force | Out-Null
$env:GOCACHE = $GoCache

Push-Location $RepoRoot
try {
    Write-Host 'Starting Rockion development mode...' -ForegroundColor Cyan
    Write-Host "Go cache: $GoCache" -ForegroundColor DarkGray
    & wails dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] wails dev exited with code $LASTEXITCODE." -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
