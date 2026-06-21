[CmdletBinding()]
param(
    [switch]$KeepExisting
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$GoCache = Join-Path $RepoRoot '.codex-tmp\wails-go-cache'
$GoPath = Join-Path $RepoRoot '.codex-tmp\wails-go-path'
$RockionDevPath = Join-Path $RepoRoot 'build\bin\rockion-dev.exe'

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

$GoCommand = Resolve-Tool 'go' @(
    'C:\Program Files\Go\bin\go.exe',
    'C:\Program Files (x86)\Go\bin\go.exe'
)
$NodeCommand = Resolve-Tool 'node' @('C:\Program Files\nodejs\node.exe')
$NpmCommand = Resolve-Tool 'npm' @('C:\Program Files\nodejs\npm.cmd')
$WailsCommand = Resolve-Tool 'wails' @(
    (Join-Path $env:USERPROFILE 'go\bin\wails.exe')
)

$missing = @()
if (-not $GoCommand) { $missing += 'go' }
if (-not $NodeCommand) { $missing += 'node' }
if (-not $NpmCommand) { $missing += 'npm' }
if (-not $WailsCommand) { $missing += 'wails' }
if ($missing.Count -gt 0) {
    Write-Host "[ERROR] Missing required tool(s): $($missing -join ', ')." -ForegroundColor Red
    Write-Host '        Run .\dev\windows-doctor.ps1 for setup details.' -ForegroundColor DarkGray
    exit 1
}

foreach ($toolPath in @($GoCommand, $NodeCommand, $NpmCommand, $WailsCommand)) {
    $toolDir = Split-Path -Parent $toolPath
    if ($toolDir -and $env:Path -notlike "*$toolDir*") {
        $env:Path = "$toolDir;$env:Path"
    }
}

if (-not $KeepExisting) {
    Stop-RockionDevelopmentProcesses
}

New-Item -ItemType Directory -Path $GoCache -Force | Out-Null
New-Item -ItemType Directory -Path $GoPath -Force | Out-Null
$env:GOCACHE = $GoCache
$env:GOPATH = $GoPath
$env:GOMODCACHE = Join-Path $GoPath 'pkg\mod'

Push-Location $RepoRoot
try {
    Write-Host 'Starting Rockion development mode...' -ForegroundColor Cyan
    Write-Host "Go build cache: $env:GOCACHE" -ForegroundColor DarkGray
    Write-Host "Go module cache: $env:GOMODCACHE" -ForegroundColor DarkGray
    & $WailsCommand dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] wails dev exited with code $LASTEXITCODE." -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
