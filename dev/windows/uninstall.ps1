# Uninstall Rockion on Windows.
#
#   pwsh dev/windows/uninstall.ps1            # remove the installed (NSIS) build
#   pwsh dev/windows/uninstall.ps1 -Portable  # delete the portable exe
#
# The installer build registers a silent uninstaller; this finds and runs it.
# Approve the UAC prompt if it appears.

[CmdletBinding()]
param([switch]$Portable)

$ErrorActionPreference = 'Stop'

if ($Portable) {
    $exe = Join-Path $env:LOCALAPPDATA 'rockion.exe'
    if (Test-Path $exe) {
        Remove-Item $exe -Force
        Write-Host "Removed $exe"
    } else {
        Write-Host 'No portable rockion.exe found in %LOCALAPPDATA%.'
    }
    return
}

$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RockionRockion'
if (Test-Path $key) {
    $uninstall = (Get-ItemProperty $key).QuietUninstallString
    Write-Host 'Uninstalling Rockion (approve the UAC prompt if it appears)...'
    Start-Process cmd -ArgumentList '/c', $uninstall -Wait
    Write-Host 'Done.'
} else {
    Write-Host 'Rockion installer build is not registered. (Portable? re-run with -Portable.)'
}
