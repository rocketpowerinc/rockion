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
$checksums = 'SHA256SUMS.txt'
$tempDir = Join-Path $env:TEMP "rockion-install-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $asset = if ($Portable) {
        'rockion-windows-amd64.exe'
    } else {
        'rockion-windows-amd64-installer.exe'
    }
    $download = Join-Path $tempDir $asset
    $manifest = Join-Path $tempDir $checksums
    $baseUrl = "https://github.com/$repo/releases/latest/download"

    Write-Host "Downloading $asset..."
    Invoke-WebRequest "$baseUrl/$asset" -OutFile $download
    Invoke-WebRequest "$baseUrl/$checksums" -OutFile $manifest

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $manifest) {
        if ($line -match '^([0-9A-Fa-f]{64})\s+\*?(.+)$' -and $Matches[2] -eq $asset) {
            $expected = $Matches[1].ToLowerInvariant()
            break
        }
    }
    if (-not $expected) {
        throw "$checksums does not contain a valid checksum for $asset."
    }
    $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "$asset failed SHA-256 verification."
    }
    Write-Host 'SHA-256 verified.'

    if ($Portable) {
        $dest = Join-Path $env:LOCALAPPDATA 'rockion.exe'
        Move-Item -LiteralPath $download -Destination $dest -Force
        Write-Host 'Launching Rockion...'
        Start-Process $dest
    } else {
        Write-Host 'Installing silently (approve the UAC prompt if it appears)...'
        Start-Process -FilePath $download -ArgumentList '/S' -Wait
        Write-Host 'Done. Launch Rockion from the Start menu.'
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
