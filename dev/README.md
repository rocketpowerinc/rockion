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
- JSON metadata, PowerShell syntax, Git whitespace, and the six-target release
  workflow.

Use `-SkipInstall` only when `frontend/node_modules` is already synchronized
with `package-lock.json`. Use `-SkipVulnerabilityScan` only for offline local
development, never for a release.

## Create a release

```powershell
.\dev\windows-create-release.ps1
```

The script prompts for a semantic version, updates Rockion's version metadata
and changelog, runs the full test suite, creates a release commit and annotated
tag, then pushes them. Pushing the tag starts `.github/workflows/release.yml`.

GitHub Actions builds these native packages:

- Windows x64 and ARM64
- macOS Intel and Apple Silicon
- Linux x64 and ARM64

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

The GitHub release is created as a draft. Review the generated artifacts and
checksums before publishing it.
