[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$Failures = [System.Collections.Generic.List[string]]::new()
$Warnings = [System.Collections.Generic.List[string]]::new()

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

function Add-DoctorResult {
    param(
        [ValidateSet('OK', 'WARN', 'FAIL')]
        [string]$Status,
        [string]$Name,
        [string]$Detail
    )

    $color = switch ($Status) {
        'OK' { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
    }
    Write-Host ("[{0}] {1}" -f $Status, $Name) -ForegroundColor $color
    if ($Detail) {
        Write-Host "      $Detail" -ForegroundColor DarkGray
    }
    if ($Status -eq 'FAIL') {
        $Failures.Add($Name)
    } elseif ($Status -eq 'WARN') {
        $Warnings.Add($Name)
    }
}

function Test-CommandVersion {
    param(
        [string]$Name,
        [string]$CommandPath,
        [string[]]$ToolArgs = @('--version')
    )

    if (-not $CommandPath) {
        Add-DoctorResult 'FAIL' $Name 'Not found on PATH or in a standard fallback location.'
        return
    }
    try {
        $output = & $CommandPath @ToolArgs 2>&1 | Select-Object -First 1
        Add-DoctorResult 'OK' $Name "$CommandPath ($output)"
    } catch {
        Add-DoctorResult 'FAIL' $Name $_.Exception.Message
    }
}

function Test-ToolExists {
    param(
        [string]$Name,
        [string]$CommandPath
    )

    if (-not $CommandPath) {
        Add-DoctorResult 'FAIL' $Name 'Not found on PATH or in a standard fallback location.'
        return
    }
    Add-DoctorResult 'OK' $Name $CommandPath
}

function Test-WritableDirectory {
    param(
        [string]$Name,
        [string]$Path
    )

    try {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        $probe = Join-Path $Path '.doctor-write-test'
        Set-Content -LiteralPath $probe -Value 'ok'
        Remove-Item -LiteralPath $probe -Force
        Add-DoctorResult 'OK' $Name $Path
    } catch {
        Add-DoctorResult 'FAIL' $Name $_.Exception.Message
    }
}

function Test-GoLineEndings {
    $git = Resolve-Tool 'git' @(
        'C:\Program Files\Git\cmd\git.exe',
        'C:\Program Files\Git\bin\git.exe',
        'C:\Program Files (x86)\Git\cmd\git.exe'
    )
    if (-not $git) {
        Add-DoctorResult 'WARN' 'Go line endings' 'git was not found; skipping repository EOL check.'
        return
    }

    Push-Location $RepoRoot
    try {
        $bad = @(& $git -c "safe.directory=$RepoRoot" ls-files --eol -- '*.go' 2>$null | Where-Object { $_ -notmatch 'w/lf' })
        if ($bad.Count -eq 0) {
            Add-DoctorResult 'OK' 'Go line endings' 'Tracked Go files are checked out with LF endings.'
        } else {
            Add-DoctorResult 'FAIL' 'Go line endings' "Run gofmt or git checkout after .gitattributes normalization. Bad files: $($bad.Count)"
        }
    } catch {
        Add-DoctorResult 'WARN' 'Go line endings' $_.Exception.Message
    } finally {
        Pop-Location
    }
}

function Test-GoModuleNetwork {
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri 'https://proxy.golang.org/gopkg.in/yaml.v3/@v/v3.0.1.info' `
            -TimeoutSec 10
        Add-DoctorResult 'OK' 'Go module network' "proxy.golang.org returned HTTP $([int]$response.StatusCode)."
    } catch {
        Add-DoctorResult 'WARN' 'Go module network' 'Could not reach proxy.golang.org. Existing module cache may still allow tests to run offline.'
    }
}

Write-Host '===========================================' -ForegroundColor Cyan
Write-Host '          Rockion Windows Doctor' -ForegroundColor Cyan
Write-Host '===========================================' -ForegroundColor Cyan
Write-Host "Repository: $RepoRoot" -ForegroundColor DarkGray
Write-Host

$GoCommand = Resolve-Tool 'go' @(
    'C:\Program Files\Go\bin\go.exe',
    'C:\Program Files (x86)\Go\bin\go.exe'
)
$GofmtCommand = Resolve-Tool 'gofmt' @(
    'C:\Program Files\Go\bin\gofmt.exe',
    'C:\Program Files (x86)\Go\bin\gofmt.exe'
)
$NodeCommand = Resolve-Tool 'node' @('C:\Program Files\nodejs\node.exe')
$NpmCommand = Resolve-Tool 'npm' @('C:\Program Files\nodejs\npm.cmd')
$WailsCommand = Resolve-Tool 'wails' @(
    (Join-Path $env:USERPROFILE 'go\bin\wails.exe')
)

Test-CommandVersion 'Go' $GoCommand @('version')
Test-ToolExists 'gofmt' $GofmtCommand
Test-CommandVersion 'Node.js' $NodeCommand @('--version')
Test-CommandVersion 'npm' $NpmCommand @('--version')
Test-CommandVersion 'Wails CLI' $WailsCommand @('version')

Test-WritableDirectory 'Go build cache' (Join-Path $RepoRoot '.codex-tmp\release-go-cache')
Test-WritableDirectory 'Go module cache' (Join-Path $RepoRoot '.codex-tmp\release-go-path')
Test-WritableDirectory 'Frontend dependency folder parent' (Join-Path $RepoRoot 'frontend')
Test-GoLineEndings
Test-GoModuleNetwork

Write-Host
if ($Failures.Count -gt 0) {
    Write-Host "RESULT: FAIL ($($Failures.Count) failure(s), $($Warnings.Count) warning(s))" -ForegroundColor Red
    exit 1
}

if ($Warnings.Count -gt 0) {
    Write-Host "RESULT: WARN ($($Warnings.Count) warning(s), no failures)" -ForegroundColor Yellow
    exit 0
}

Write-Host 'RESULT: PASS' -ForegroundColor Green
