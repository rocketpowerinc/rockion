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
    'ubuntu-22.04-arm',
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
if ($workflow.Contains('draft: true')) {
    Add-Failure 'Release workflow must publish completed releases, not drafts.'
}
if ($Failures.Count -eq 0) {
    Write-OK 'All six release targets and checksums are configured.'
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'frontend\dist\.gitkeep'))) {
    Add-Failure 'frontend/dist/.gitkeep is required so Go embed works before the first frontend build.'
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'frontend\public\.gitkeep'))) {
    Add-Failure 'frontend/public/.gitkeep is required so Vite restores the embed placeholder after builds.'
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
