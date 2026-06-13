# Rockion development scripts

These scripts are designed to be launched from Windows PowerShell. They resolve
the repository root automatically, so they can be run from any working
directory.

## Run all release checks

```powershell
.\dev\tests\Run-all-tests.ps1
```

The suite checks:

- Go formatting, module integrity, tests, vetting, and known vulnerabilities.
- Reproducible frontend installation, production build, and dependency audit.
- JSON metadata, PowerShell syntax, Git whitespace, and the three-target release
  workflow.

Use `-SkipInstall` only when `frontend/node_modules` is already synchronized
with `package-lock.json`. Use `-SkipVulnerabilityScan` only for offline local
development, never for a release.

## Test the Debian package without releasing

Commit and push the branch you want to test, then run:

```powershell
.\dev\windows-test-debian-package.ps1
```

This starts `.github/workflows/debian-preflight.yml`, which builds the amd64
`.deb`, installs it in a clean Debian 12 container, and launches Rockion. It
does not build Windows or macOS packages, update version metadata, create a tag,
or publish a release.

Use `-Ref branch-name` to test another pushed branch or `-NoWait` to start the
workflow without watching it finish.

## Create a release

```powershell
.\dev\windows-create-release.ps1
```

The script prompts for a semantic version, updates Rockion's version metadata
and changelog, runs the full test suite, creates a release commit and annotated
tag, then pushes them. Before creating the tag, it runs the Debian 12 package
preflight. Pushing the tag starts `.github/workflows/release.yml`.

GitHub Actions builds these native packages:

- Windows x64
- macOS Apple Silicon
- Debian 12 amd64 package

The Linux package is built inside Debian 12 and declares GTK and WebKitGTK as
system package dependencies. It must install and launch in a clean Debian 12
container before publication.

Wails desktop packages depend on native platform toolchains. The Windows script
therefore coordinates the release instead of attempting to cross-compile
macOS and Linux GUI packages on Windows.

Useful options:

```powershell
# Prepare the commit and tag locally without pushing.
.\dev\windows-create-release.ps1 -Version 0.2.0 -SkipPublish

# Push the release without waiting for GitHub Actions to finish.
.\dev\windows-create-release.ps1 -Version 0.2.0 -NoWait
```

After all target builds and checksum generation pass, GitHub publishes the
release and its generated artifacts automatically.
