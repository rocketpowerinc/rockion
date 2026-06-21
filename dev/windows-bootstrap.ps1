[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$SkipWinget
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$NodeVersion = (Get-Content -LiteralPath (Join-Path $RepoRoot '.nvmrc') -Raw).Trim()
$PackageJson = Get-Content -LiteralPath (Join-Path $RepoRoot 'frontend\package.json') -Raw |
    ConvertFrom-Json
$NpmVersion = ($PackageJson.packageManager -replace '^npm@', '')
$WailsVersion = 'v2.12.0'

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

function Write-Step {
    param([string]$Text)
    Write-Host
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-CommandHint {
    param([string]$Command)
    Write-Host "    $Command" -ForegroundColor DarkGray
}

function Invoke-BootstrapCommand {
    param(
        [string]$Label,
        [scriptblock]$Command,
        [string]$Hint
    )

    Write-Step $Label
    if ($Hint) {
        Write-CommandHint $Hint
    }
    if ($Install) {
        & $Command
    }
}

Write-Host '============================================' -ForegroundColor Cyan
Write-Host '          Rockion Windows Bootstrap' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host "Repository: $RepoRoot" -ForegroundColor DarkGray
Write-Host "Node.js:    $NodeVersion" -ForegroundColor DarkGray
Write-Host "npm:        $NpmVersion" -ForegroundColor DarkGray
Write-Host "Wails CLI:  $WailsVersion" -ForegroundColor DarkGray

if (-not $Install) {
    Write-Host
    Write-Host 'Dry run only. Re-run with -Install to execute installation commands.' -ForegroundColor Yellow
}

$GoCommand = Resolve-Tool 'go' @(
    'C:\Program Files\Go\bin\go.exe',
    'C:\Program Files (x86)\Go\bin\go.exe'
)
if (-not $GoCommand) {
    Write-Step 'Install Go first'
    Write-Host 'Go was not found. Install Go 1.26.4 from https://go.dev/dl/, then reopen PowerShell.' -ForegroundColor Red
    exit 1
}
Write-Step 'Go is available'
Write-Host (& $GoCommand version) -ForegroundColor Green

$NvmCommand = Resolve-Tool 'nvm' @(
    (Join-Path $env:ProgramFiles 'nvm\nvm.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nvm\nvm.exe')
)
if (-not $NvmCommand) {
    if ($SkipWinget) {
        Write-Step 'Install nvm-windows manually'
        Write-Host 'nvm was not found and -SkipWinget was used.' -ForegroundColor Yellow
        Write-CommandHint 'winget install CoreyButler.NVMforWindows'
        Write-Host 'After installing, close and reopen PowerShell, then rerun this script.' -ForegroundColor DarkGray
        exit 1
    }

    Invoke-BootstrapCommand `
        'Install nvm-windows' `
        { winget install --id CoreyButler.NVMforWindows --exact } `
        'winget install --id CoreyButler.NVMforWindows --exact'

    if ($Install) {
        Write-Host
        Write-Host 'Close and reopen PowerShell, then rerun:' -ForegroundColor Yellow
        Write-CommandHint '.\dev\windows-bootstrap.ps1 -Install'
        exit 0
    }
} else {
    Write-Step 'nvm-windows is available'
    Write-Host $NvmCommand -ForegroundColor Green
}

if ($NvmCommand) {
    Invoke-BootstrapCommand `
        "Install Node.js $NodeVersion" `
        { & $NvmCommand install $NodeVersion } `
        "nvm install $NodeVersion"
    Invoke-BootstrapCommand `
        "Use Node.js $NodeVersion" `
        { & $NvmCommand use $NodeVersion } `
        "nvm use $NodeVersion"
}

$NodeCommand = Resolve-Tool 'node' @('C:\Program Files\nodejs\node.exe')
$NpmCommand = Resolve-Tool 'npm' @('C:\Program Files\nodejs\npm.cmd')
if ($NodeCommand) {
    Write-Step 'Node.js is available'
    Write-Host (& $NodeCommand --version) -ForegroundColor Green
} elseif ($Install) {
    Write-Host
    Write-Host 'Node.js may require a fresh PowerShell session after nvm use.' -ForegroundColor Yellow
}

if ($NpmCommand) {
    Write-Step 'npm is available'
    Write-Host (& $NpmCommand --version) -ForegroundColor Green
    Invoke-BootstrapCommand `
        "Install npm $NpmVersion globally" `
        { & $NpmCommand install -g "npm@$NpmVersion" } `
        "npm install -g npm@$NpmVersion"
} elseif ($Install) {
    Write-Host
    Write-Host 'npm may require a fresh PowerShell session after nvm use.' -ForegroundColor Yellow
}

Invoke-BootstrapCommand `
    "Install Wails CLI $WailsVersion" `
    { & $GoCommand install "github.com/wailsapp/wails/v2/cmd/wails@$WailsVersion" } `
    "go install github.com/wailsapp/wails/v2/cmd/wails@$WailsVersion"

$WailsCommand = Resolve-Tool 'wails' @((Join-Path $env:USERPROFILE 'go\bin\wails.exe'))
if ($WailsCommand) {
    Write-Step 'Wails CLI is available'
    Write-Host (& $WailsCommand version) -ForegroundColor Green
} elseif ($Install) {
    Write-Host
    Write-Host 'Wails installed under your Go bin directory, but PATH may need a fresh PowerShell session.' -ForegroundColor Yellow
}

Write-Step 'Next checks'
Write-CommandHint '.\dev\windows-doctor.ps1'
Write-CommandHint '.\dev\tests\Run-all-tests.ps1'
Write-CommandHint '.\dev\windows-dev.ps1'

if ($Install) {
    Write-Host
    Write-Host 'Bootstrap finished. If Node, npm, or Wails are still not detected, close and reopen PowerShell.' -ForegroundColor Green
}
