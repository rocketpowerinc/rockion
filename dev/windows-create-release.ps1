[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Publish,
    [switch]$SkipPublish,
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

function Stop-Release {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Native {
    param(
        [string]$Description,
        [scriptblock]$Command
    )

    Write-Host $Description -ForegroundColor Gray
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "$Description failed."
    }
}

function Get-RepositorySlug {
    $remote = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0) {
        Stop-Release 'Could not read the origin remote.'
    }
    if ($remote -match 'github\.com[/:](?<slug>[^/]+/[^/]+?)(?:\.git)?$') {
        return $Matches.slug
    }
    Stop-Release "Origin is not a supported GitHub URL: $remote"
}

if ($Publish -and $SkipPublish) {
    Stop-Release 'Use either -Publish or -SkipPublish, not both.'
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Stop-Release 'This release coordinator must be run from Windows.'
}

$ShouldPublish = -not $SkipPublish
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$TestRunner = Join-Path $RepoRoot 'dev\tests\Run-all-tests.ps1'
$PowerShell = (Get-Process -Id $PID).Path

Set-Location $RepoRoot

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '        Rockion Release Coordinator' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host

foreach ($command in @('git', 'go', 'node', 'npm', 'wails')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Stop-Release "$command was not found on PATH."
    }
}

$RequiredWailsVersion = 'v2.12.0'
$InstalledWailsVersion = (& wails version | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $InstalledWailsVersion -ne $RequiredWailsVersion) {
    Stop-Release "Wails CLI $RequiredWailsVersion is required; found '$InstalledWailsVersion'."
}

& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    Stop-Release 'The Git index already contains staged changes. Unstage them before releasing.'
}

$Branch = (& git branch --show-current).Trim()
if (-not $Branch) {
    Stop-Release 'Releases cannot be created from a detached HEAD.'
}

$Repository = Get-RepositorySlug
$LatestVersion = $null
try {
    $latest = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$Repository/releases/latest" `
        -Headers @{ Accept = 'application/vnd.github+json' } `
        -TimeoutSec 10
    if ($latest.tag_name) {
        $LatestVersion = $latest.tag_name.TrimStart('v')
    }
} catch {
    $latestTag = (& git tag --sort=-version:refname | Select-Object -First 1)
    if ($latestTag) {
        $LatestVersion = $latestTag.TrimStart('v')
    }
    Write-Host '[WARN] GitHub release lookup failed; using local tags for version guidance.' -ForegroundColor Yellow
}

$Suggestion = 'for example 0.2.0'
if ($LatestVersion -and $LatestVersion -match '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$') {
    $nextPatch = [int]$Matches.patch + 1
    $Suggestion = "latest is v$LatestVersion; suggested $($Matches.major).$($Matches.minor).$nextPatch"
}

$RawVersion = $Version
if (-not $RawVersion) {
    $RawVersion = Read-Host "Enter the release version ($Suggestion)"
}
if ([string]::IsNullOrWhiteSpace($RawVersion)) {
    Stop-Release 'Version cannot be empty.'
}
$CleanVersion = $RawVersion.Trim().TrimStart('v')
if ($CleanVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    Stop-Release 'Version must be semantic, such as 0.2.0 or 1.0.0-rc.1.'
}

$Tag = "v$CleanVersion"
& git rev-parse -q --verify "refs/tags/$Tag" *> $null
if ($LASTEXITCODE -eq 0) {
    Stop-Release "Local tag $Tag already exists."
}
& git ls-remote --exit-code --tags origin "refs/tags/$Tag" *> $null
if ($LASTEXITCODE -eq 0) {
    Stop-Release "Remote tag $Tag already exists."
} elseif ($LASTEXITCODE -ne 2) {
    Stop-Release "Could not verify whether remote tag $Tag exists."
}

Write-Host
Write-Host "Preparing $Tag on branch $Branch..." -ForegroundColor Cyan

$WailsPath = Join-Path $RepoRoot 'wails.json'
$WailsText = Get-Content -Raw -LiteralPath $WailsPath
$CurrentWailsVersion = (
    Get-Content -Raw -LiteralPath $WailsPath | ConvertFrom-Json
).info.productVersion
if ($CurrentWailsVersion -ne $CleanVersion) {
    $UpdatedWails = [regex]::Replace(
        $WailsText,
        '("productVersion"\s*:\s*")[^"]+(")',
        "`${1}$CleanVersion`${2}",
        1
    )
    if ($UpdatedWails -eq $WailsText) {
        Stop-Release 'Could not update productVersion in wails.json.'
    }
    [System.IO.File]::WriteAllText($WailsPath, $UpdatedWails, [System.Text.UTF8Encoding]::new($false))
}

Push-Location (Join-Path $RepoRoot 'frontend')
try {
    Invoke-Native 'Updating frontend package metadata...' {
        & npm version $CleanVersion --no-git-tag-version --allow-same-version
    }
} finally {
    Pop-Location
}

$ChangelogPath = Join-Path $RepoRoot 'CHANGELOG.md'
$Changelog = Get-Content -Raw -LiteralPath $ChangelogPath
if (-not $Changelog.Contains('## [Unreleased]')) {
    Stop-Release 'CHANGELOG.md does not contain an Unreleased section.'
}
if (-not $Changelog.Contains("## [$CleanVersion]")) {
    $ReleaseHeading = "## [Unreleased]`n`n## [$CleanVersion] - $(Get-Date -Format 'yyyy-MM-dd')"
    $Changelog = $Changelog.Replace('## [Unreleased]', $ReleaseHeading)
}
$ReleaseLink = "[$CleanVersion]: https://github.com/$Repository/releases/tag/$Tag"
if (-not $Changelog.Contains("[$CleanVersion]:")) {
    $Changelog = $Changelog.TrimEnd() + "`n$ReleaseLink`n"
}
[System.IO.File]::WriteAllText($ChangelogPath, $Changelog, [System.Text.UTF8Encoding]::new($false))

Write-Host
Write-Host 'Running the complete release test suite...' -ForegroundColor Cyan
& $PowerShell -NoProfile -ExecutionPolicy Bypass -File $TestRunner
if ($LASTEXITCODE -ne 0) {
    Stop-Release 'Release checks failed. Version changes were left in the worktree for inspection.'
}

Write-Host
Invoke-Native 'Building a local Windows x64 smoke artifact...' {
    & wails build -platform windows/amd64 -clean -trimpath -o rockion-windows-amd64.exe
}

Invoke-Native 'Staging release source changes...' { & git add --all }

$StagedFiles = @(& git diff --cached --name-only)
$ForbiddenPatterns = @(
    '(^|/).*\.key$',
    '(^|/).*\.pfx$',
    '(^|/).*\.p12$',
    '(^|/)\.env(?:\.|$)',
    '(^|/)\.codex-tmp/',
    '(^|/)\.release/',
    '^build/bin/',
    '^frontend/(dist|node_modules|wailsjs)/'
)
$ForbiddenFiles = @(
    $StagedFiles | Where-Object {
        $path = $_
        @($ForbiddenPatterns | Where-Object { $path -match $_ }).Count -gt 0
    }
)
if ($ForbiddenFiles.Count -gt 0) {
    Write-Host '[ERROR] Refusing to commit generated artifacts or possible secrets:' -ForegroundColor Red
    $ForbiddenFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    & git reset --mixed HEAD
    exit 1
}

Invoke-Native 'Checking staged whitespace...' { & git diff --cached --check }
Invoke-Native "Creating release commit for $Tag..." {
    & git commit -m "release: prepare $Tag"
}
Invoke-Native "Creating annotated tag $Tag..." {
    & git tag -a $Tag -m "Rockion $Tag"
}

if (-not $ShouldPublish) {
    Write-Host
    Write-Host "$Tag is committed and tagged locally. Publishing was skipped." -ForegroundColor Yellow
    Write-Host "Push later with: git push origin $Branch; git push origin $Tag" -ForegroundColor Yellow
    exit 0
}

Write-Host
Invoke-Native "Pushing branch $Branch..." { & git push origin $Branch }
Invoke-Native "Pushing tag $Tag..." { & git push origin $Tag }

$ActionsURL = "https://github.com/$Repository/actions/workflows/release.yml"
Write-Host
Write-Host "Release workflow started: $ActionsURL" -ForegroundColor Green

if ($NoWait) {
    exit 0
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host '[WARN] GitHub CLI is unavailable; not waiting for the release workflow.' -ForegroundColor Yellow
    exit 0
}

Write-Host 'Waiting for GitHub Actions to register the tag workflow...' -ForegroundColor Gray
$RunId = $null
for ($attempt = 0; $attempt -lt 24 -and -not $RunId; $attempt++) {
    $json = & gh run list `
        --repo $Repository `
        --workflow release.yml `
        --branch $Tag `
        --event push `
        --limit 1 `
        --json databaseId 2>$null
    if ($LASTEXITCODE -eq 0 -and $json) {
        $run = $json | ConvertFrom-Json | Select-Object -First 1
        $RunId = $run.databaseId
    }
    if (-not $RunId) {
        Start-Sleep -Seconds 5
    }
}

if (-not $RunId) {
    Write-Host '[WARN] Could not locate the workflow run. Check GitHub Actions manually.' -ForegroundColor Yellow
    exit 0
}

Invoke-Native "Watching release workflow run $RunId..." {
    & gh run watch $RunId --repo $Repository --exit-status
}

Write-Host
Write-Host "Release build completed. Review the draft at:" -ForegroundColor Green
Write-Host "https://github.com/$Repository/releases/tag/$Tag" -ForegroundColor Cyan
