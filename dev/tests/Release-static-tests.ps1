[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$GoCache = Join-Path $RepoRoot '.codex-tmp\release-go-cache'
$Failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure {
    param([string]$Message)
    $Failures.Add($Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-OK {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

Write-Host "Rockion release/static checks - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host

Write-Host '[CHECK] PowerShell syntax' -ForegroundColor Gray
$scriptFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'dev') -Recurse -File -Filter '*.ps1')
foreach ($file in $scriptFiles) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $file.FullName,
        [ref]$tokens,
        [ref]$errors
    )
    foreach ($parseError in $errors) {
        Add-Failure "$($file.FullName): $($parseError.Message)"
    }
}
if ($Failures.Count -eq 0) {
    Write-OK "Parsed $($scriptFiles.Count) PowerShell scripts."
}

Write-Host '[CHECK] Release metadata' -ForegroundColor Gray
try {
    $wails = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'wails.json') | ConvertFrom-Json
    $package = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'frontend\package.json') | ConvertFrom-Json
    $lockPath = Join-Path $RepoRoot 'frontend\package-lock.json'
    $convertFromJson = Get-Command ConvertFrom-Json
    if ($convertFromJson.Parameters.ContainsKey('AsHashtable')) {
        $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json -AsHashtable
        $lockVersion = $lock['version']
        $lockRootVersion = $lock['packages']['']['version']
    } else {
        $lockVersions = & node -e @'
const lock = require(process.argv[1]);
console.log(lock.version);
console.log(lock.packages[""].version);
'@ $lockPath
        if ($LASTEXITCODE -ne 0 -or $lockVersions.Count -ne 2) {
            throw 'Could not read package-lock.json versions.'
        }
        $lockVersion = $lockVersions[0]
        $lockRootVersion = $lockVersions[1]
    }
    if ($wails.info.productVersion -ne $package.version) {
        Add-Failure "wails.json version $($wails.info.productVersion) differs from package.json $($package.version)."
    }
    if ($package.version -ne $lockVersion -or $package.version -ne $lockRootVersion) {
        Add-Failure 'package.json and package-lock.json versions differ.'
    }
    if ($wails.'frontend:install' -ne 'npm ci') {
        Add-Failure 'wails.json must use npm ci for reproducible installs.'
    }
} catch {
    Add-Failure "Release metadata is invalid JSON: $($_.Exception.Message)"
}
if ($Failures.Count -eq 0) {
    Write-OK "Release metadata version is $($wails.info.productVersion)."
}

Write-Host '[CHECK] Release target matrix' -ForegroundColor Gray
$workflowPath = Join-Path $RepoRoot '.github\workflows\release.yml'
$workflow = Get-Content -Raw -LiteralPath $workflowPath
$requiredTargets = @(
    'windows/amd64',
    'windows/arm64',
    'darwin/amd64',
    'darwin/arm64',
    'linux/amd64',
    'linux/arm64'
)
foreach ($target in $requiredTargets) {
    if (-not $workflow.Contains("platform: $target")) {
        Add-Failure "Release workflow is missing $target."
    }
}
foreach ($requiredText in @(
    'windows-11-arm',
    'macos-15-intel',
    'ubuntu-22.04',
    'ubuntu-22.04-arm',
    'ubuntu-24.04',
    'ubuntu-24.04-arm',
    'ubuntu-26.04',
    'ubuntu-26.04-arm',
    'debian:12',
    'fedora:42',
    'libwebkit2gtk-4.1-dev',
    '-tags webkit2_41',
    'rockion-linux-x86_64.AppImage',
    'rockion-linux-aarch64.AppImage',
    'bash ./dev/linux/package-appimage.sh',
    'Verify Linux build linkage',
    'Verify Linux AppImage contents',
    'Test Linux package',
    'linux-distro-compatibility',
    'APPIMAGE_EXTRACT_AND_RUN=1',
    'docker run --rm --interactive',
    'libegl1 libgl1',
    'libglvnd-egl libglvnd-glx',
    'xvfb-run',
    'linux-compatibility',
    'choco install nsis',
    'makensis.exe',
    'GITHUB_PATH',
    'draft: false',
    'Prepare embedded frontend directory',
    'wails generate module -nocolour',
    'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
    'SHA256SUMS.txt'
)) {
    if (-not $workflow.Contains($requiredText)) {
        Add-Failure "Release workflow is missing required configuration: $requiredText"
    }
}
if ($workflow.Contains('libwebkit2gtk-4.0-dev')) {
    if (-not $workflow.Contains('Package Linux AppImage')) {
        Add-Failure 'WebKitGTK 4.0 may only be used as a bundled AppImage compatibility baseline.'
    }
}
foreach ($legacyAsset in @(
    'build/bin/rockion-linux-amd64.tar.gz',
    'build/bin/rockion-linux-arm64.tar.gz'
)) {
    if ($workflow.Contains($legacyAsset)) {
        Add-Failure "Release workflow still publishes legacy Linux archive: $legacyAsset"
    }
}
if ($workflow.Contains('draft: true')) {
    Add-Failure 'Release workflow must publish completed releases, not drafts.'
}
if ($Failures.Count -eq 0) {
    Write-OK 'All six release targets, AppImages, compatibility gates, and checksums are configured.'
}

$appImageScript = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'dev\linux\package-appimage.sh')
foreach ($requiredText in @(
    'linuxdeploy_sha=',
    'apprun_sha=',
    'gtk_plugin_sha=',
    'download_verified',
    'WebKitWebProcess',
    'WebKitNetworkProcess',
    'libwebkit2gtkinjectedbundle.so',
    '--plugin gtk',
    '--output appimage'
)) {
    if (-not $appImageScript.Contains($requiredText)) {
        Add-Failure "AppImage packaging script is missing required configuration: $requiredText"
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'frontend\dist\.gitkeep'))) {
    Add-Failure 'frontend/dist/.gitkeep is required so Go embed works before the first frontend build.'
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'frontend\public\.gitkeep'))) {
    Add-Failure 'frontend/public/.gitkeep is required so Vite restores the embed placeholder after builds.'
}

$releaseCoordinator = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'dev\windows-create-release.ps1')
foreach ($requiredText in @(
    'git ls-remote --refs --tags origin',
    '$attempt -le 3',
    'Git reported:'
)) {
    if (-not $releaseCoordinator.Contains($requiredText)) {
        Add-Failure "Release coordinator is missing resilient remote-tag handling: $requiredText"
    }
}
if ($releaseCoordinator.Contains('git ls-remote --exit-code')) {
    Add-Failure 'Release coordinator must not depend on the special git ls-remote --exit-code status for missing tags.'
}

Write-Host '[CHECK] Changelog structure' -ForegroundColor Gray
$changelog = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'CHANGELOG.md')
if (-not $changelog.Contains('## [Unreleased]')) {
    Add-Failure 'CHANGELOG.md is missing the Unreleased section.'
} else {
    Write-OK 'CHANGELOG.md contains an Unreleased section.'
}

Write-Host '[CHECK] Workflow YAML and pinned actions' -ForegroundColor Gray
Push-Location $RepoRoot
try {
    New-Item -ItemType Directory -Path $GoCache -Force | Out-Null
    $env:GOCACHE = $GoCache
    & go test . -run TestGitHubWorkflowsAreValidAndActionsArePinned -count=1
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'Workflow validation test failed.'
    } else {
        Write-OK 'Workflow validation test passed.'
    }

    Write-Host '[CHECK] Git whitespace' -ForegroundColor Gray
    & git diff --check
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'git diff --check failed.'
    } else {
        Write-OK 'git diff --check passed.'
    }
} finally {
    Pop-Location
}

Write-Host
if ($Failures.Count -gt 0) {
    Write-Host "RESULT: FAIL ($($Failures.Count) issue(s))" -ForegroundColor Red
    exit 1
}

Write-Host 'RESULT: PASS' -ForegroundColor Green
