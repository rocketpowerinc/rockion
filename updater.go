package main

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	latestReleaseAPI = "https://api.github.com/repos/rocketpowerinc/rockion/releases/latest"
	maxReleaseJSON   = 2 << 20
	maxChecksumFile  = 1 << 20
	maxUpdateAsset   = 300 << 20
)

//go:embed wails.json
var embeddedWailsConfig []byte

type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	CanAutoUpdate   bool   `json:"canAutoUpdate"`
	Platform        string `json:"platform"`
	Architecture    string `json:"architecture"`
	InstallMode     string `json:"installMode"`
	AssetName       string `json:"assetName"`
	ReleaseURL      string `json:"releaseUrl"`
	ReleaseNotes    string `json:"releaseNotes"`
	PublishedAt     string `json:"publishedAt"`
	Message         string `json:"message"`
}

type githubRelease struct {
	TagName     string         `json:"tag_name"`
	HTMLURL     string         `json:"html_url"`
	Body        string         `json:"body"`
	PublishedAt string         `json:"published_at"`
	Assets      []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
	Size               int64  `json:"size"`
}

type embeddedConfig struct {
	Info struct {
		ProductVersion string `json:"productVersion"`
	} `json:"info"`
}

func currentAppVersion() (string, error) {
	var config embeddedConfig
	if err := json.Unmarshal(embeddedWailsConfig, &config); err != nil {
		return "", fmt.Errorf("read embedded version: %w", err)
	}
	if _, err := parseSemver(config.Info.ProductVersion); err != nil {
		return "", fmt.Errorf("invalid embedded version: %w", err)
	}
	return config.Info.ProductVersion, nil
}

func (a *App) CheckForUpdates() (UpdateInfo, error) {
	ctx, cancel := context.WithTimeout(appContext(a.ctx), 30*time.Second)
	defer cancel()

	release, err := fetchLatestRelease(ctx)
	if err != nil {
		return UpdateInfo{}, err
	}
	return buildUpdateInfo(release)
}

// InstallUpdate downloads and verifies the newest release. Windows installer
// builds launch the new installer after Rockion exits; portable builds replace
// their executable with a detached helper. Other platforms open the release
// page because automatic installation is currently Windows-only.
func (a *App) InstallUpdate() (UpdateInfo, error) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()

	ctx, cancel := context.WithTimeout(appContext(a.ctx), 6*time.Minute)
	defer cancel()

	release, err := fetchLatestRelease(ctx)
	if err != nil {
		return UpdateInfo{}, err
	}
	info, err := buildUpdateInfo(release)
	if err != nil {
		return UpdateInfo{}, err
	}
	if !info.UpdateAvailable {
		return info, errors.New("Rockion is already up to date")
	}
	if !info.CanAutoUpdate {
		return info, errors.New("automatic installation is not available on this platform")
	}

	asset, ok := findReleaseAsset(release.Assets, info.AssetName)
	if !ok {
		return info, fmt.Errorf("release asset %q is missing", info.AssetName)
	}
	checksums, ok := findReleaseAsset(release.Assets, "SHA256SUMS.txt")
	if !ok {
		return info, errors.New("release checksum manifest is missing")
	}

	updateDir, err := os.MkdirTemp("", "rockion-update-*")
	if err != nil {
		return info, fmt.Errorf("create update directory: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(updateDir)
		}
	}()

	manifest, err := downloadBytes(ctx, checksums, maxChecksumFile)
	if err != nil {
		return info, fmt.Errorf("download checksums: %w", err)
	}
	assetPath := filepath.Join(updateDir, filepath.Base(asset.Name))
	hash, err := downloadFile(ctx, asset, assetPath)
	if err != nil {
		return info, fmt.Errorf("download update: %w", err)
	}
	if err := verifyDownloadedAsset(asset, manifest, hash); err != nil {
		return info, err
	}

	executable, err := os.Executable()
	if err != nil {
		return info, fmt.Errorf("locate Rockion executable: %w", err)
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return info, fmt.Errorf("resolve Rockion executable: %w", err)
	}
	scriptPath := filepath.Join(updateDir, "install-update.ps1")
	if err := os.WriteFile(scriptPath, []byte(windowsUpdateScript), 0o600); err != nil {
		return info, fmt.Errorf("write update helper: %w", err)
	}
	if err := startDetachedUpdateHelper(
		scriptPath,
		strconv.Itoa(os.Getpid()),
		assetPath,
		executable,
		info.InstallMode,
	); err != nil {
		return info, fmt.Errorf("start update helper: %w", err)
	}

	cleanup = false
	a.closeMu.Lock()
	a.allowClose = true
	a.closeMu.Unlock()
	go func() {
		time.Sleep(350 * time.Millisecond)
		wailsruntime.Quit(a.ctx)
	}()
	return info, nil
}

func appContext(ctx context.Context) context.Context {
	if ctx != nil {
		return ctx
	}
	return context.Background()
}

func fetchLatestRelease(ctx context.Context) (githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseAPI, nil)
	if err != nil {
		return githubRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Rockion-Updater")

	response, err := githubClient(45 * time.Second).Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("contact GitHub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return githubRelease{}, fmt.Errorf("GitHub release check returned %s", response.Status)
	}
	data, err := readLimited(response.Body, maxReleaseJSON)
	if err != nil {
		return githubRelease{}, fmt.Errorf("read GitHub response: %w", err)
	}
	var release githubRelease
	if err := json.Unmarshal(data, &release); err != nil {
		return githubRelease{}, fmt.Errorf("decode GitHub response: %w", err)
	}
	if release.TagName == "" || release.HTMLURL == "" {
		return githubRelease{}, errors.New("GitHub returned incomplete release metadata")
	}
	return release, nil
}

func buildUpdateInfo(release githubRelease) (UpdateInfo, error) {
	current, err := currentAppVersion()
	if err != nil {
		return UpdateInfo{}, err
	}
	comparison, err := compareSemver(release.TagName, current)
	if err != nil {
		return UpdateInfo{}, fmt.Errorf("invalid release version %q: %w", release.TagName, err)
	}

	mode := installMode()
	assetName := expectedAssetName(goruntime.GOOS, goruntime.GOARCH, mode)
	_, hasAsset := findReleaseAsset(release.Assets, assetName)
	_, hasChecksums := findReleaseAsset(release.Assets, "SHA256SUMS.txt")
	canAuto := comparison > 0 && goruntime.GOOS == "windows" && hasAsset && hasChecksums

	message := "Rockion is up to date."
	if comparison > 0 {
		switch {
		case canAuto:
			message = "A verified update is ready to install."
		case assetName == "":
			message = "A newer release exists, but this system architecture is not packaged."
		default:
			message = "A newer release is available from GitHub."
		}
	}

	notes := release.Body
	if len(notes) > 8000 {
		notes = notes[:8000]
	}
	return UpdateInfo{
		CurrentVersion:  current,
		LatestVersion:   strings.TrimPrefix(release.TagName, "v"),
		UpdateAvailable: comparison > 0,
		CanAutoUpdate:   canAuto,
		Platform:        goruntime.GOOS,
		Architecture:    goruntime.GOARCH,
		InstallMode:     mode,
		AssetName:       assetName,
		ReleaseURL:      release.HTMLURL,
		ReleaseNotes:    notes,
		PublishedAt:     release.PublishedAt,
		Message:         message,
	}, nil
}

func installMode() string {
	if goruntime.GOOS != "windows" {
		return "manual"
	}
	executable, err := os.Executable()
	if err == nil {
		if _, err := os.Stat(filepath.Join(filepath.Dir(executable), "uninstall.exe")); err == nil {
			return "installer"
		}
	}
	return "portable"
}

func expectedAssetName(goos, arch, mode string) string {
	if arch != "amd64" && arch != "arm64" {
		return ""
	}
	switch goos {
	case "windows":
		if mode == "installer" {
			return "rockion-windows-" + arch + "-installer.exe"
		}
		return "rockion-windows-" + arch + ".exe"
	case "darwin":
		return "rockion-macos-" + arch + ".zip"
	case "linux":
		if arch == "amd64" {
			return "rockion-linux-x86_64.AppImage"
		}
		return "rockion-linux-aarch64.AppImage"
	default:
		return ""
	}
}

func findReleaseAsset(assets []releaseAsset, name string) (releaseAsset, bool) {
	if name == "" {
		return releaseAsset{}, false
	}
	for _, asset := range assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return releaseAsset{}, false
}

func downloadBytes(ctx context.Context, asset releaseAsset, limit int64) ([]byte, error) {
	response, err := downloadResponse(ctx, asset, limit)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := readLimited(response.Body, limit)
	if err != nil {
		return nil, err
	}
	if err := verifyDigest(asset.Digest, data); err != nil {
		return nil, err
	}
	return data, nil
}

func downloadFile(ctx context.Context, asset releaseAsset, target string) (string, error) {
	response, err := downloadResponse(ctx, asset, maxUpdateAsset)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hasher), io.LimitReader(response.Body, maxUpdateAsset+1))
	closeErr := file.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if written > maxUpdateAsset {
		return "", errors.New("update asset exceeds the size limit")
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func downloadResponse(ctx context.Context, asset releaseAsset, limit int64) (*http.Response, error) {
	if asset.Size <= 0 || asset.Size > limit {
		return nil, fmt.Errorf("invalid asset size %d", asset.Size)
	}
	if !trustedGitHubURL(asset.BrowserDownloadURL) {
		return nil, errors.New("release asset URL is not trusted")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "Rockion-Updater")
	response, err := githubClient(5 * time.Minute).Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("download returned %s", response.Status)
	}
	return response, nil
}

func githubClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			if !trustedGitHubURL(req.URL.String()) {
				return errors.New("redirected to an untrusted download host")
			}
			return nil
		},
	}
}

func trustedGitHubURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" ||
		host == "api.github.com" ||
		strings.HasSuffix(host, ".github.com") ||
		host == "githubusercontent.com" ||
		strings.HasSuffix(host, ".githubusercontent.com")
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("response exceeds the size limit")
	}
	return data, nil
}

func verifyDownloadedAsset(asset releaseAsset, manifest []byte, actualHash string) error {
	expectedHash, err := checksumFor(manifest, asset.Name)
	if err != nil {
		return err
	}
	if !strings.EqualFold(expectedHash, actualHash) {
		return errors.New("downloaded update failed SHA-256 verification")
	}
	if asset.Digest != "" {
		digestHash, ok := strings.CutPrefix(asset.Digest, "sha256:")
		if !ok || len(digestHash) != sha256.Size*2 {
			return errors.New("release asset has an invalid GitHub digest")
		}
		if !strings.EqualFold(digestHash, actualHash) {
			return errors.New("downloaded update does not match GitHub's digest")
		}
	}
	return nil
}

func verifyDigest(digest string, data []byte) error {
	if digest == "" {
		return nil
	}
	expected, ok := strings.CutPrefix(digest, "sha256:")
	if !ok || len(expected) != sha256.Size*2 {
		return errors.New("release asset has an invalid GitHub digest")
	}
	actual := sha256.Sum256(data)
	if !strings.EqualFold(expected, hex.EncodeToString(actual[:])) {
		return errors.New("release asset failed GitHub digest verification")
	}
	return nil
}

func checksumFor(manifest []byte, filename string) (string, error) {
	for _, line := range strings.Split(string(manifest), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if name != filename {
			continue
		}
		if len(fields[0]) != sha256.Size*2 {
			return "", errors.New("checksum manifest contains an invalid SHA-256 value")
		}
		if _, err := hex.DecodeString(fields[0]); err != nil {
			return "", errors.New("checksum manifest contains an invalid SHA-256 value")
		}
		return strings.ToLower(fields[0]), nil
	}
	return "", fmt.Errorf("checksum manifest does not contain %q", filename)
}

type semanticVersion struct {
	major      int
	minor      int
	patch      int
	prerelease []string
}

func compareSemver(left, right string) (int, error) {
	a, err := parseSemver(left)
	if err != nil {
		return 0, err
	}
	b, err := parseSemver(right)
	if err != nil {
		return 0, err
	}
	for _, pair := range [][2]int{{a.major, b.major}, {a.minor, b.minor}, {a.patch, b.patch}} {
		if pair[0] < pair[1] {
			return -1, nil
		}
		if pair[0] > pair[1] {
			return 1, nil
		}
	}
	if len(a.prerelease) == 0 && len(b.prerelease) == 0 {
		return 0, nil
	}
	if len(a.prerelease) == 0 {
		return 1, nil
	}
	if len(b.prerelease) == 0 {
		return -1, nil
	}
	for index := 0; index < len(a.prerelease) && index < len(b.prerelease); index++ {
		leftID, rightID := a.prerelease[index], b.prerelease[index]
		leftNumber, leftErr := strconv.Atoi(leftID)
		rightNumber, rightErr := strconv.Atoi(rightID)
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNumber < rightNumber {
				return -1, nil
			}
			if leftNumber > rightNumber {
				return 1, nil
			}
		case leftErr == nil:
			return -1, nil
		case rightErr == nil:
			return 1, nil
		default:
			if leftID < rightID {
				return -1, nil
			}
			if leftID > rightID {
				return 1, nil
			}
		}
	}
	if len(a.prerelease) < len(b.prerelease) {
		return -1, nil
	}
	if len(a.prerelease) > len(b.prerelease) {
		return 1, nil
	}
	return 0, nil
}

func parseSemver(value string) (semanticVersion, error) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	value, _, _ = strings.Cut(value, "+")
	core, prerelease, hasPrerelease := strings.Cut(value, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return semanticVersion{}, errors.New("version must contain major, minor, and patch numbers")
	}
	numbers := make([]int, 3)
	for index, part := range parts {
		if part == "" {
			return semanticVersion{}, errors.New("version contains an empty number")
		}
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return semanticVersion{}, errors.New("version contains a non-numeric value")
		}
		numbers[index] = number
	}
	version := semanticVersion{major: numbers[0], minor: numbers[1], patch: numbers[2]}
	if hasPrerelease {
		if prerelease == "" {
			return semanticVersion{}, errors.New("version contains an empty prerelease")
		}
		version.prerelease = strings.Split(prerelease, ".")
		for _, identifier := range version.prerelease {
			if identifier == "" {
				return semanticVersion{}, errors.New("version contains an empty prerelease identifier")
			}
			for _, character := range identifier {
				if (character < '0' || character > '9') &&
					(character < 'A' || character > 'Z') &&
					(character < 'a' || character > 'z') &&
					character != '-' {
					return semanticVersion{}, errors.New("version contains an invalid prerelease identifier")
				}
			}
		}
	}
	return version, nil
}

const windowsUpdateScript = `param(
    [Parameter(Mandatory = $true)][int]$RockionProcessId,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][ValidateSet('installer', 'portable')][string]$Mode
)
$ErrorActionPreference = 'Stop'
Wait-Process -Id $RockionProcessId -ErrorAction SilentlyContinue
if ($Mode -eq 'installer') {
    Start-Process -FilePath $Source -Wait
} else {
    $updated = $false
    for ($attempt = 0; $attempt -lt 20 -and -not $updated; $attempt++) {
        try {
            Copy-Item -LiteralPath $Source -Destination $Target -Force
            $updated = $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $updated) {
        throw 'Could not replace the Rockion executable.'
    }
    Start-Process -FilePath $Target
}
Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue
`
