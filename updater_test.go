package main

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestCompareSemver(t *testing.T) {
	tests := []struct {
		left  string
		right string
		want  int
	}{
		{"v0.1.5", "0.1.4", 1},
		{"1.0.0", "1.0.0", 0},
		{"1.0.0-rc.2", "1.0.0-rc.1", 1},
		{"1.0.0", "1.0.0-rc.1", 1},
		{"1.0.0-beta", "1.0.0", -1},
		{"2.0.0", "10.0.0", -1},
	}
	for _, test := range tests {
		got, err := compareSemver(test.left, test.right)
		if err != nil {
			t.Fatalf("compareSemver(%q, %q): %v", test.left, test.right, err)
		}
		if got != test.want {
			t.Errorf("compareSemver(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func TestExpectedAssetName(t *testing.T) {
	tests := []struct {
		goos string
		arch string
		mode string
		want string
	}{
		{"windows", "amd64", "installer", "rockion-windows-amd64-installer.exe"},
		{"windows", "amd64", "portable", "rockion-windows-amd64.exe"},
		{"windows", "arm64", "portable", ""},
		{"darwin", "arm64", "manual", "rockion-macos-arm64.zip"},
		{"darwin", "amd64", "manual", ""},
		{"linux", "amd64", "manual", "rockion-linux-amd64.deb"},
		{"linux", "arm64", "manual", ""},
		{"linux", "386", "manual", ""},
	}
	for _, test := range tests {
		if got := expectedAssetName(test.goos, test.arch, test.mode); got != test.want {
			t.Errorf("expectedAssetName(%q, %q, %q) = %q, want %q", test.goos, test.arch, test.mode, got, test.want)
		}
	}
}

func TestVerifyDownloadedAsset(t *testing.T) {
	data := []byte("verified Rockion update")
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	asset := releaseAsset{
		Name:   "rockion-windows-amd64.exe",
		Digest: "sha256:" + hash,
	}
	manifest := []byte(hash + "  " + asset.Name + "\n")
	if err := verifyDownloadedAsset(asset, manifest, hash); err != nil {
		t.Fatalf("valid update rejected: %v", err)
	}
	if err := verifyDownloadedAsset(asset, manifest, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err == nil {
		t.Fatal("tampered update was accepted")
	}
}

func TestTrustedGitHubURL(t *testing.T) {
	trusted := []string{
		"https://github.com/rocketpowerinc/rockion/releases/download/v1.0.0/file.exe",
		"https://release-assets.githubusercontent.com/github-production-release-asset/file",
		"https://api.github.com/repos/rocketpowerinc/rockion/releases/latest",
	}
	for _, value := range trusted {
		if !trustedGitHubURL(value) {
			t.Errorf("trusted URL rejected: %s", value)
		}
	}
	untrusted := []string{
		"http://github.com/file.exe",
		"https://github.com.evil.example/file.exe",
		"https://user@github.com/file.exe",
		"https://example.com/file.exe",
	}
	for _, value := range untrusted {
		if trustedGitHubURL(value) {
			t.Errorf("untrusted URL accepted: %s", value)
		}
	}
}
