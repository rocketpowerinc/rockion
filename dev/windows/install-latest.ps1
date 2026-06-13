# Download and install the latest Rockion Windows release from GitHub.
# Re-run any time to update to the newest published release.
#
#   pwsh dev/windows/install-latest.ps1            # silent installer (persistent)
#   pwsh dev/windows/install-latest.ps1 -Portable  # portable .exe, download + run
#
# GitHub points /releases/latest/ at the most recent published release, so no
# special tag is needed.

[CmdletBinding()]
param([switch]$Portable)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'rocketpowerinc/rockion'

if ($Portable) {
    $asset = 'rockion-windows-amd64.exe'
    $dest = Join-Path $env:LOCALAPPDATA 'rockion.exe'
    Write-Host "Downloading $asset (portable)..."
    Invoke-WebRequest "https://github.com/$repo/releases/latest/download/$asset" -OutFile $dest
    Write-Host "Launching Rockion..."
    Start-Process $dest
} else {
    $asset = 'rockion-windows-amd64-installer.exe'
    $tmp = Join-Path $env:TEMP $asset
    Write-Host "Downloading $asset (installer)..."
    Invoke-WebRequest "https://github.com/$repo/releases/latest/download/$asset" -OutFile $tmp
    Write-Host 'Installing silently (approve the UAC prompt if it appears)...'
    Start-Process -FilePath $tmp -ArgumentList '/S' -Wait
    Remove-Item $tmp -Force
    Write-Host 'Done. Launch Rockion from the Start menu.'
}
