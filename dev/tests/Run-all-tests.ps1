[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipVulnerabilityScan
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PowerShell = (Get-Process -Id $PID).Path

$checks = @(
    @{
        Name = 'Go and dependency security'
        Script = Join-Path $ScriptDir 'GO-tests.ps1'
        Args = if ($SkipVulnerabilityScan) { @('-SkipVulnerabilityScan') } else { @() }
    },
    @{
        Name = 'Frontend and dependency security'
        Script = Join-Path $ScriptDir 'Frontend-tests.ps1'
        Args = if ($SkipInstall) { @('-SkipInstall') } else { @() }
    },
    @{
        Name = 'Release and static integrity'
        Script = Join-Path $ScriptDir 'Release-static-tests.ps1'
        Args = @()
    }
)

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '          Rockion Test Suite' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan

foreach ($check in $checks) {
    Write-Host
    Write-Host "=== $($check.Name) ===" -ForegroundColor Cyan
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $check.Script
    ) + @($check.Args)
    & $PowerShell @arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host
        Write-Host "[ERROR] $($check.Name) failed." -ForegroundColor Red
        exit 1
    }
}

Write-Host
Write-Host 'All Rockion checks passed.' -ForegroundColor Green
