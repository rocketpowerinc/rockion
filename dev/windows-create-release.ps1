[CmdletBinding()]
param(
    [string]$Version,
    [string]$Ref,
    [switch]$AnduinOSPreflightOnly,
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

function Invoke-AnduinOSPackagePreflight {
    param(
        [string]$Repository,
        [string]$Ref,
        [switch]$NoWait
    )

    foreach ($command in @('git', 'gh')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            Stop-Release "$command was not found on PATH."
        }
    }

    $Branch = $Ref
    if (-not $Branch) {
        $Branch = (& git branch --show-current).Trim()
    }
    if (-not $Branch) {
        Stop-Release 'Specify -Ref when running from a detached HEAD.'
    }

    $Status = @(& git status --porcelain)
    if ($Status.Count -gt 0) {
        Stop-Release 'Commit your changes before testing; GitHub Actions can only test pushed commits.'
    }

    $LocalCommit = (& git rev-parse $Branch).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $LocalCommit) {
        Stop-Release "Could not resolve local ref $Branch."
    }

    $RemoteResult = @(& git ls-remote --heads origin "refs/heads/$Branch" 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "Could not read origin/$Branch. Git reported: $($RemoteResult -join [Environment]::NewLine)"
    }
    if ($RemoteResult.Count -eq 0) {
        Stop-Release "Branch $Branch has not been pushed to origin."
    }
    $RemoteCommit = ($RemoteResult[0] -split '\s+')[0]
    if ($RemoteCommit -ne $LocalCommit) {
        Stop-Release "Local $Branch is not synchronized with origin/$Branch. Push the commit before testing."
    }

    $ExistingRunJson = & gh run list `
        --repo $Repository `
        --workflow anduinos-preflight.yml `
        --branch $Branch `
        --event workflow_dispatch `
        --limit 20 `
        --json databaseId 2>$null
    $ExistingRunIds = @()
    if ($LASTEXITCODE -eq 0 -and $ExistingRunJson) {
        $ExistingRunIds = @($ExistingRunJson | ConvertFrom-Json | ForEach-Object { $_.databaseId })
    } elseif ($LASTEXITCODE -ne 0) {
        Write-Host '[WARN] GitHub has not indexed the AnduinOS workflow yet; dispatch will be retried.' -ForegroundColor Yellow
    }

    Write-Host 'Starting AnduinOS package preflight...' -ForegroundColor Cyan
    $DispatchSucceeded = $false
    for ($attempt = 1; $attempt -le 12 -and -not $DispatchSucceeded; $attempt++) {
        $DispatchResult = @(
            & gh workflow run anduinos-preflight.yml --repo $Repository --ref $Branch 2>&1
        )
        if ($LASTEXITCODE -eq 0) {
            $DispatchSucceeded = $true
            break
        }
        if ($attempt -lt 12) {
            Write-Host "[WARN] Workflow dispatch attempt $attempt failed; retrying in 5 seconds." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
    if (-not $DispatchSucceeded) {
        if ($DispatchResult) {
            Write-Host ($DispatchResult -join [Environment]::NewLine) -ForegroundColor DarkGray
        }
        Stop-Release 'Could not start the AnduinOS package preflight workflow.'
    }

    Write-Host 'Waiting for GitHub Actions to register the workflow...' -ForegroundColor Gray
    $RunId = $null
    for ($attempt = 0; $attempt -lt 24 -and -not $RunId; $attempt++) {
        $json = & gh run list `
            --repo $Repository `
            --workflow anduinos-preflight.yml `
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
        Stop-Release 'Could not locate the AnduinOS package preflight workflow run.'
    }

    $RunURL = "https://github.com/$Repository/actions/runs/$RunId"
    Write-Host "AnduinOS package preflight: $RunURL" -ForegroundColor Cyan
    if ($NoWait) {
        return
    }

    & gh run watch $RunId --repo $Repository --exit-status
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "AnduinOS package preflight run $RunId failed."
    }

    Write-Host 'The amd64 package installed and launched on the AnduinOS baseline.' -ForegroundColor Green
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

if ($AnduinOSPreflightOnly) {
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host '      Rockion AnduinOS Package Test' -ForegroundColor Cyan
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host
    Invoke-AnduinOSPackagePreflight -Repository (Get-RepositorySlug) -Ref $Ref -NoWait:$NoWait
    exit 0
}

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
$RequiredGoVersion = 'go1.26.4'
$RequiredNodeVersion = 'v24.16.0'
$RequiredNpmVersion = '11.17.0'
$InstalledGoVersion = (& go version).Trim()
$InstalledNodeVersion = (& node --version).Trim()
$InstalledNpmVersion = (& npm --version).Trim()
if ($InstalledGoVersion -notmatch [regex]::Escape($RequiredGoVersion)) {
    Stop-Release "Go $RequiredGoVersion is required; found '$InstalledGoVersion'."
}
if ($InstalledNodeVersion -ne $RequiredNodeVersion) {
    Stop-Release "Node.js $RequiredNodeVersion is required; found '$InstalledNodeVersion'."
}
if ($InstalledNpmVersion -ne $RequiredNpmVersion) {
    Stop-Release "npm $RequiredNpmVersion is required; found '$InstalledNpmVersion'."
}
$WailsVersionOutput = (& wails version 2>&1 | Out-String)
$VersionMatch = [regex]::Match($WailsVersionOutput, 'v\d+\.\d+\.\d+')
$InstalledWailsVersion = if ($VersionMatch.Success) { $VersionMatch.Value } else { '' }
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
$VersionCandidates = [System.Collections.Generic.List[version]]::new()
$LocalTags = @(& git tag --list 'v*')
foreach ($localTag in $LocalTags) {
    $candidate = $localTag.TrimStart('v')
    if ($candidate -match '^\d+\.\d+\.\d+$') {
        $VersionCandidates.Add([version]$candidate)
    }
}
try {
    $latest = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$Repository/releases/latest" `
        -Headers @{ Accept = 'application/vnd.github+json' } `
        -TimeoutSec 10
    if ($latest.tag_name) {
        $publishedVersion = $latest.tag_name.TrimStart('v')
        if ($publishedVersion -match '^\d+\.\d+\.\d+$') {
            $VersionCandidates.Add([version]$publishedVersion)
        }
    }
} catch {
    Write-Host '[WARN] GitHub release lookup failed; using local tags for version guidance.' -ForegroundColor Yellow
}

$Suggestion = 'for example 0.2.0'
if ($VersionCandidates.Count -gt 0) {
    $LatestVersion = $VersionCandidates | Sort-Object -Descending | Select-Object -First 1
    $nextPatch = $LatestVersion.Build + 1
    $Suggestion = "latest tag is v$LatestVersion; suggested $($LatestVersion.Major).$($LatestVersion.Minor).$nextPatch"
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
$RemoteTagResult = @()
$RemoteTagExitCode = -1
for ($attempt = 1; $attempt -le 3; $attempt++) {
    $RemoteTagResult = @(& git ls-remote --refs --tags origin "refs/tags/$Tag" 2>&1)
    $RemoteTagExitCode = $LASTEXITCODE
    if ($RemoteTagExitCode -eq 0) {
        break
    }
    if ($attempt -lt 3) {
        Write-Host "[WARN] Remote tag check failed (attempt $attempt of 3); retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
}
if ($RemoteTagExitCode -ne 0) {
    $RemoteTagError = ($RemoteTagResult | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($RemoteTagError)) {
        $RemoteTagError = "git ls-remote exited with code $RemoteTagExitCode."
    }
    Stop-Release "Could not verify whether remote tag $Tag exists. Git reported: $RemoteTagError"
}
if ($RemoteTagResult.Count -gt 0) {
    Stop-Release "Remote tag $Tag already exists."
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
    '(^|/).*\.pem$',
    '(^|/).*\.pfx$',
    '(^|/).*\.p12$',
    '(^|/).*\.der$',
    '(^|/).*\.jks$',
    '(^|/).*\.keystore$',
    '(^|/).*\.kdbx$',
    '(^|/).*\.ovpn$',
    '(^|/)(id_rsa|id_ed25519)(?:\.pub)?$',
    '(^|/)(credentials?|secrets?|tokens?)(?:\.[^/]+)?$',
    '(^|/)\.env(?:\.|$)',
    '(^|/)\.codex-tmp/',
    '(^|/)\.release/',
    '^build/bin/',
    '^frontend/node_modules/',
    '^frontend/wailsjs/',
    '^frontend/dist/(?!\.gitkeep$)'
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

$SecretPatterns = @(
    @{ Name = 'private key'; Pattern = ('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----') },
    @{ Name = 'AWS access key'; Pattern = '\bAKIA[0-9A-Z]{16}\b' },
    @{ Name = 'GitHub token'; Pattern = ('\bgh' + '[pousr]_[A-Za-z0-9]{30,}\b') },
    @{ Name = 'GitHub fine-grained token'; Pattern = ('\bgithub_' + 'pat_[A-Za-z0-9_]{30,}\b') },
    @{ Name = 'Slack token'; Pattern = ('\bxox' + '[baprs]-[A-Za-z0-9-]{20,}\b') },
    @{ Name = 'OpenAI-style secret'; Pattern = ('\bsk-' + '[A-Za-z0-9_-]{20,}\b') }
)
$SecretFindings = [System.Collections.Generic.List[string]]::new()
foreach ($path in $StagedFiles) {
    $numstat = @(& git diff --cached --numstat -- $path)
    if ($numstat.Count -eq 0 -or $numstat[0] -match '^-\s+-\s+') {
        continue
    }
    $content = (& git show ":$path" 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        continue
    }
    foreach ($secretPattern in $SecretPatterns) {
        if ($content -match $secretPattern.Pattern) {
            $SecretFindings.Add("$path ($($secretPattern.Name))")
        }
    }
}
if ($SecretFindings.Count -gt 0) {
    Write-Host '[ERROR] Refusing to commit staged content that resembles a secret:' -ForegroundColor Red
    $SecretFindings | Sort-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    & git reset --mixed HEAD
    exit 1
}

Invoke-Native 'Checking staged whitespace...' { & git diff --cached --check }
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No new release changes to commit; reusing the current HEAD for $Tag." -ForegroundColor Yellow
} else {
    Invoke-Native "Creating release commit for $Tag..." {
        & git commit -m "release: prepare $Tag"
    }
}

if (-not $ShouldPublish) {
    Invoke-Native "Creating annotated tag $Tag..." {
        & git tag -a $Tag -m "Rockion $Tag"
    }
    Write-Host
    Write-Host "$Tag is committed and tagged locally. Publishing was skipped." -ForegroundColor Yellow
    Write-Host "Push later with: git push origin $Branch; git push origin $Tag" -ForegroundColor Yellow
    exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Stop-Release 'GitHub CLI is required to validate release builds before tagging.'
}

Write-Host
Invoke-Native "Pushing branch $Branch..." { & git push origin $Branch }

Invoke-Native "Creating annotated tag $Tag..." {
    & git tag -a $Tag -m "Rockion $Tag"
}
Invoke-Native "Pushing tag $Tag..." { & git push origin $Tag }

$ActionsURL = "https://github.com/$Repository/actions/workflows/release.yml"
Write-Host
Write-Host "Release workflow started: $ActionsURL" -ForegroundColor Green

if ($NoWait) {
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
Write-Host "Release build and publication completed:" -ForegroundColor Green
Write-Host "https://github.com/$Repository/releases/tag/$Tag" -ForegroundColor Cyan
