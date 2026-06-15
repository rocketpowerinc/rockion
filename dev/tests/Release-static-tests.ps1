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
    if ($package.packageManager -ne 'npm@11.17.0') {
        Add-Failure "package.json must pin packageManager to npm@11.17.0; found '$($package.packageManager)'."
    }
    $nvmVersion = (Get-Content -Raw -LiteralPath (Join-Path $RepoRoot '.nvmrc')).Trim()
    if ($nvmVersion -ne '24.16.0') {
        Add-Failure ".nvmrc must pin Node.js 24.16.0; found '$nvmVersion'."
    }
    $goMod = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'go.mod')
    if (-not $goMod.Contains('toolchain go1.26.4')) {
        Add-Failure 'go.mod must pin toolchain go1.26.4.'
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
foreach ($requiredText in @(
    'platform: windows/amd64',
    'platform: darwin/arm64',
    'runs-on: ubuntu-24.04',
    'wails build -platform linux/amd64',
    'libwebkit2gtk-4.1-dev',
    '-tags webkit2_41',
    'libwebkit2gtk-4.1.so.0',
    'readelf -d build/bin/rockion',
    'libwebkit2gtk-4.0.so.37',
    'readelf -d "$binary"',
    'rockion-anduinos-amd64.deb',
    'bash ./dev/linux/package-anduinos-deb.sh',
    'dpkg-deb --info',
    'Install and launch on AnduinOS baseline (amd64)',
    'sudo apt-get install -y',
    'xvfb-run',
    'build-anduinos',
    'test-anduinos',
    'choco install nsis',
    'NSIS_VERSION: "3.12.0"',
    '--version="$env:NSIS_VERSION"',
    'NODE_VERSION: "24.16.0"',
    'NPM_VERSION: "11.17.0"',
    'GO_VERSION: "1.26.4"',
    'makensis.exe',
    'GITHUB_PATH',
    'draft: false',
    'Prepare embedded frontend directory',
    'wails generate module -nocolour',
    'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
    'SHA256SUMS.txt',
    'WINDOWS_SIGNING_CERTIFICATE_BASE64',
    'MACOS_SIGNING_CERTIFICATE_BASE64',
    'signtool verify',
    'xcrun notarytool submit',
    'xcrun stapler validate'
)) {
    if (-not $workflow.Contains($requiredText)) {
        Add-Failure "Release workflow is missing required configuration: $requiredText"
    }
}
foreach ($forbiddenText in @(
    'platform: windows/arm64',
    'platform: darwin/amd64',
    'platform: linux/arm64',
    'windows-11-arm',
    'macos-15-intel',
    'AppImage',
    'appimage',
    'linuxdeploy',
    'container: debian:12',
    'libwebkit2gtk-4.0-dev',
    'rockion-linux-amd64.deb',
    'ubuntu-26.04',
    'fedora:42',
    'linux-distro-compatibility',
    'docker run --rm --interactive'
)) {
    if ($workflow.Contains($forbiddenText)) {
        Add-Failure "Release workflow contains removed target configuration: $forbiddenText"
    }
}
if ($workflow.Contains('draft: true')) {
    Add-Failure 'Release workflow must publish completed releases, not drafts.'
}
if ($workflow.Contains('workflow_dispatch:')) {
    Add-Failure 'Release workflow must only run for release tags; use the AnduinOS package preflight for manual checks.'
}
if ($Failures.Count -eq 0) {
    Write-OK 'Windows x64, macOS ARM64, and AnduinOS amd64 releases are configured.'
}

$anduinosWorkflowPath = Join-Path $RepoRoot '.github\workflows\anduinos-preflight.yml'
if (-not (Test-Path -LiteralPath $anduinosWorkflowPath)) {
    Add-Failure 'The standalone AnduinOS package preflight workflow is missing.'
} else {
    $anduinosWorkflow = Get-Content -Raw -LiteralPath $anduinosWorkflowPath
    foreach ($requiredText in @(
        'workflow_dispatch:',
        'NODE_VERSION: "24.16.0"',
        'NPM_VERSION: "11.17.0"',
        'GO_VERSION: "1.26.4"',
        'Build AnduinOS package (amd64)',
        'runs-on: ubuntu-24.04',
        'wails build -platform linux/amd64 -clean -trimpath -tags webkit2_41',
        'libwebkit2gtk-4.1-dev',
        'readelf -d build/bin/rockion',
        'readelf -d "$binary"',
        'The installed package contains a WebKitGTK 4.0-linked binary.',
        'bash ./dev/linux/package-anduinos-deb.sh',
        'rockion-anduinos-amd64.deb',
        'Install and launch on AnduinOS baseline (amd64)',
        'xvfb-run -a rockion'
    )) {
        if (-not $anduinosWorkflow.Contains($requiredText)) {
            Add-Failure "AnduinOS package preflight workflow is missing required configuration: $requiredText"
        }
    }
    foreach ($forbiddenText in @(
        'windows/amd64',
        'windows/arm64',
        'darwin/amd64',
        'darwin/arm64',
        'linux/arm64',
        'AppImage',
        'appimage',
        'linuxdeploy',
        'container: debian:12',
        'libwebkit2gtk-4.0-dev',
        'rockion-linux-amd64.deb',
        'docker run --rm --interactive',
        'action-gh-release',
        'Publish release'
    )) {
        if ($anduinosWorkflow.Contains($forbiddenText)) {
            Add-Failure "AnduinOS preflight contains removed or non-Linux release behavior: $forbiddenText"
        }
    }
}

$packageScriptPath = Join-Path $RepoRoot 'dev\linux\package-anduinos-deb.sh'
if (-not (Test-Path -LiteralPath $packageScriptPath)) {
    Add-Failure 'The AnduinOS packaging script is missing.'
} else {
    $packageScript = Get-Content -Raw -LiteralPath $packageScriptPath
    foreach ($requiredText in @(
        'Architecture: amd64',
        'libgtk-3-0t64',
        'libwebkit2gtk-4.1-0',
        'xdg-utils',
        'dpkg-deb --root-owner-group --build',
        '/usr/bin/rockion',
        '/usr/share/applications/rockion.desktop',
        '/usr/share/icons/hicolor/256x256/apps',
        '/usr/share/pixmaps/rockion.png'
    )) {
        if (-not $packageScript.Contains($requiredText)) {
            Add-Failure "AnduinOS packaging script is missing required configuration: $requiredText"
        }
    }
}

foreach ($removedPath in @(
    '.github\workflows\appimage-preflight.yml',
    'dev\linux\package-appimage.sh',
    'dev\linux\patch-webkit-helper-path.py',
    'dev\windows-test-appimages.ps1',
    '.github\workflows\debian-preflight.yml',
    'dev\linux\package-deb.sh',
    'dev\windows-test-debian-package.ps1'
)) {
    if (Test-Path -LiteralPath (Join-Path $RepoRoot $removedPath)) {
        Add-Failure "Removed packaging file still exists: $removedPath"
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
    '$RequiredGoVersion = ''go1.26.4''',
    '$RequiredNodeVersion = ''v24.16.0''',
    '$RequiredNpmVersion = ''11.17.0''',
    'git ls-remote --refs --tags origin',
    '$attempt -le 3',
    'Git reported:',
    'No new release changes to commit; reusing the current HEAD',
    'Pushing tag $Tag'
)) {
    if (-not $releaseCoordinator.Contains($requiredText)) {
        Add-Failure "Release coordinator is missing resilient remote-tag handling: $requiredText"
    }
}

$ciWorkflow = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot '.github\workflows\ci.yml')
foreach ($requiredText in @(
    'NODE_VERSION: "24.16.0"',
    'NPM_VERSION: "11.17.0"',
    'GO_VERSION: "1.26.4"',
    'npm audit --audit-level=moderate',
    'govulncheck@v1.3.0 -tags webkit2_41 ./...'
)) {
    if (-not $ciWorkflow.Contains($requiredText)) {
        Add-Failure "CI workflow is missing pinned security configuration: $requiredText"
    }
}

$dependabotPath = Join-Path $RepoRoot '.github\dependabot.yml'
if (-not (Test-Path -LiteralPath $dependabotPath)) {
    Add-Failure 'Dependabot configuration is missing.'
} else {
    $dependabot = Get-Content -Raw -LiteralPath $dependabotPath
    foreach ($requiredText in @(
        'package-ecosystem: npm',
        'package-ecosystem: gomod',
        'package-ecosystem: github-actions',
        'interval: weekly'
    )) {
        if (-not $dependabot.Contains($requiredText)) {
            Add-Failure "Dependabot configuration is missing: $requiredText"
        }
    }
}
if ($releaseCoordinator.Contains('git ls-remote --exit-code')) {
    Add-Failure 'Release coordinator must not depend on the special git ls-remote --exit-code status for missing tags.'
}
if ($releaseCoordinator.Contains('workflow run anduinos-preflight.yml')) {
    Add-Failure 'Release coordinator must not build the AnduinOS package twice; the preflight is standalone.'
}
foreach ($requiredText in @(
    '.*\.pem$',
    '.*\.keystore$',
    '.*\.kdbx$',
    '$SecretPatterns',
    'private key',
    'GitHub fine-grained token',
    'Refusing to commit staged content that resembles a secret'
)) {
    if (-not $releaseCoordinator.Contains($requiredText)) {
        Add-Failure "Release coordinator is missing secret screening behavior: $requiredText"
    }
}

$windowsInstallerPath = Join-Path $RepoRoot 'build\windows\installer\project.nsi'
if (-not (Test-Path -LiteralPath $windowsInstallerPath)) {
    Add-Failure 'Windows installer definition is missing.'
} else {
    $windowsInstaller = Get-Content -Raw -LiteralPath $windowsInstallerPath
    foreach ($requiredText in @(
        '!define PRODUCT_EXECUTABLE "Rockion.exe"',
        'InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"',
        '!define LEGACY_INSTALL_DIR "$PROGRAMFILES64\Rockion\Rockion"',
        'ExecWait ''"${LEGACY_INSTALL_DIR}\uninstall.exe" /S''',
        'RMDir /r "${LEGACY_INSTALL_DIR}"'
    )) {
        if (-not $windowsInstaller.Contains($requiredText)) {
            Add-Failure "Windows installer is missing path migration behavior: $requiredText"
        }
    }
}

$installerChecks = @(
    @{
        Path = 'dev\linux\install-latest.sh'
        Required = @('SHA256SUMS.txt', 'sha256sum', 'SHA-256 verified.', 'apt-get install')
        VerifyMarker = 'SHA-256 verified.'
        ExecuteMarker = 'apt-get install'
    },
    @{
        Path = 'dev\macos\install-latest.sh'
        Required = @('SHA256SUMS.txt', 'shasum -a 256', 'SHA-256 verified.', 'unzip -oq')
        VerifyMarker = 'SHA-256 verified.'
        ExecuteMarker = 'unzip -oq'
    },
    @{
        Path = 'dev\windows\install-latest.ps1'
        Required = @('SHA256SUMS.txt', 'Get-FileHash', 'SHA-256 verified.', 'Start-Process')
        VerifyMarker = 'SHA-256 verified.'
        ExecuteMarker = 'Start-Process'
    }
)
foreach ($installerCheck in $installerChecks) {
    $installerPath = Join-Path $RepoRoot $installerCheck.Path
    if (-not (Test-Path -LiteralPath $installerPath)) {
        Add-Failure "Verified installer script is missing: $($installerCheck.Path)"
        continue
    }
    $installer = Get-Content -Raw -LiteralPath $installerPath
    foreach ($requiredText in $installerCheck.Required) {
        if (-not $installer.Contains($requiredText)) {
            Add-Failure "$($installerCheck.Path) is missing verification behavior: $requiredText"
        }
    }
    if ($installer.IndexOf($installerCheck.VerifyMarker) -gt $installer.IndexOf($installerCheck.ExecuteMarker)) {
        Add-Failure "$($installerCheck.Path) executes the artifact before checksum verification."
    }
}

$anduinosCoordinatorPath = Join-Path $RepoRoot 'dev\windows-test-anduinos-package.ps1'
if (-not (Test-Path -LiteralPath $anduinosCoordinatorPath)) {
    Add-Failure 'The Windows AnduinOS package preflight coordinator is missing.'
} else {
    $anduinosCoordinator = Get-Content -Raw -LiteralPath $anduinosCoordinatorPath
    foreach ($requiredText in @(
        'gh workflow run anduinos-preflight.yml',
        '--event workflow_dispatch',
        '$_.headSha -eq $LocalCommit',
        'gh run watch $RunId',
        'git status --porcelain',
        'git ls-remote --heads origin',
        '$ExistingRunIds -notcontains $_.databaseId',
        '$attempt -le 12',
        'Workflow dispatch attempt $attempt failed; retrying in 5 seconds.',
        'GitHub has not indexed the AnduinOS workflow yet'
    )) {
        if (-not $anduinosCoordinator.Contains($requiredText)) {
            Add-Failure "AnduinOS package preflight coordinator is missing required behavior: $requiredText"
        }
    }
    foreach ($forbiddenText in @(
        'git tag',
        'gh release',
        'npm version'
    )) {
        if ($anduinosCoordinator.Contains($forbiddenText)) {
            Add-Failure "AnduinOS package preflight coordinator must not modify release state: $forbiddenText"
        }
    }
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
