[CmdletBinding()]
param(
    [string]$Ref,
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

function Stop-Preflight {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    exit 1
}

function Get-RepositorySlug {
    $remote = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0) {
        Stop-Preflight 'Could not read the origin remote.'
    }
    if ($remote -match 'github\.com[/:](?<slug>[^/]+/[^/]+?)(?:\.git)?$') {
        return $Matches.slug
    }
    Stop-Preflight "Origin is not a supported GitHub URL: $remote"
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Stop-Preflight 'This Debian package preflight coordinator must run on Windows.'
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $RepoRoot

foreach ($command in @('git', 'gh')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Stop-Preflight "$command was not found on PATH."
    }
}

$Branch = $Ref
if (-not $Branch) {
    $Branch = (& git branch --show-current).Trim()
}
if (-not $Branch) {
    Stop-Preflight 'Specify -Ref when running from a detached HEAD.'
}

$Status = @(& git status --porcelain)
if ($Status.Count -gt 0) {
    Stop-Preflight 'Commit your changes before testing; GitHub Actions can only test pushed commits.'
}

$LocalCommit = (& git rev-parse $Branch).Trim()
if ($LASTEXITCODE -ne 0 -or -not $LocalCommit) {
    Stop-Preflight "Could not resolve local ref $Branch."
}

$RemoteResult = @(& git ls-remote --heads origin "refs/heads/$Branch" 2>&1)
if ($LASTEXITCODE -ne 0) {
    Stop-Preflight "Could not read origin/$Branch. Git reported: $($RemoteResult -join [Environment]::NewLine)"
}
if ($RemoteResult.Count -eq 0) {
    Stop-Preflight "Branch $Branch has not been pushed to origin."
}
$RemoteCommit = ($RemoteResult[0] -split '\s+')[0]
if ($RemoteCommit -ne $LocalCommit) {
    Stop-Preflight "Local $Branch is not synchronized with origin/$Branch. Push the commit before testing."
}

$Repository = Get-RepositorySlug
$ExistingRunJson = & gh run list `
    --repo $Repository `
    --workflow debian-preflight.yml `
    --branch $Branch `
    --event workflow_dispatch `
    --limit 20 `
    --json databaseId 2>$null
if ($LASTEXITCODE -ne 0) {
    Stop-Preflight 'Could not list existing Debian package preflight runs.'
}
$ExistingRunIds = @()
if ($ExistingRunJson) {
    $ExistingRunIds = @($ExistingRunJson | ConvertFrom-Json | ForEach-Object { $_.databaseId })
}

Write-Host 'Starting Debian 12 package preflight...' -ForegroundColor Cyan
& gh workflow run debian-preflight.yml --repo $Repository --ref $Branch
if ($LASTEXITCODE -ne 0) {
    Stop-Preflight 'Could not start the Debian package preflight workflow.'
}

Write-Host 'Waiting for GitHub Actions to register the workflow...' -ForegroundColor Gray
$RunId = $null
for ($attempt = 0; $attempt -lt 24 -and -not $RunId; $attempt++) {
    $json = & gh run list `
        --repo $Repository `
        --workflow debian-preflight.yml `
        --branch $Branch `
        --event workflow_dispatch `
        --limit 10 `
        --json databaseId,headSha 2>$null
    if ($LASTEXITCODE -eq 0 -and $json) {
        $run = @($json | ConvertFrom-Json) |
            Where-Object {
                $_.headSha -eq $LocalCommit -and
                $ExistingRunIds -notcontains $_.databaseId
            } |
            Select-Object -First 1
        $RunId = $run.databaseId
    }
    if (-not $RunId) {
        Start-Sleep -Seconds 5
    }
}

if (-not $RunId) {
    Stop-Preflight 'Could not locate the Debian package preflight workflow run.'
}

$RunURL = "https://github.com/$Repository/actions/runs/$RunId"
Write-Host "Debian package preflight: $RunURL" -ForegroundColor Cyan
if ($NoWait) {
    exit 0
}

& gh run watch $RunId --repo $Repository --exit-status
if ($LASTEXITCODE -ne 0) {
    Stop-Preflight "Debian package preflight run $RunId failed."
}

Write-Host 'The amd64 package installed and launched successfully on Debian 12.' -ForegroundColor Green
