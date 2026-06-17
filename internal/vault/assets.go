package vault

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const assetRootDir = "Assets"
const maxImageBytes = 10 << 20
const maxVideoBytes = 0

// SaveImage writes validated image bytes into Assets/Images/ and returns the
// vault-relative path.
func (v *Vault) SaveImage(name string, data []byte) (string, error) {
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", errors.New("unsupported or invalid image data")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 12000 ||
		config.Height > 12000 || config.Width > maxCoverImagePixels/config.Height {
		return "", errors.New("image dimensions are invalid or too large")
	}
	extensions := map[string]string{"png": ".png", "jpeg": ".jpg", "gif": ".gif"}
	ext, ok := extensions[format]
	if !ok {
		return "", fmt.Errorf("unsupported image format: %s", format)
	}
	return v.saveAsset("Images", name, data, ext)
}

var downloadableImageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".avif": true,
}

// SaveBookmarkImage stores image bytes fetched from the web (a bookmark
// thumbnail) into Assets/Bookmarks. Unlike SaveImage it does not decode the
// bytes, so it also accepts formats the Go stdlib can't decode (webp/avif); the
// browser renders them. SVG is intentionally excluded.
func (v *Vault) SaveBookmarkImage(name string, data []byte, ext string) (string, error) {
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	if !downloadableImageExt[ext] {
		return "", errors.New("unsupported image type")
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	return v.saveAssetContentAddressed("Bookmarks", data, ext)
}

// SaveFaviconImage stores a site favicon under a human-readable, host-based name
// (e.g. Assets/Bookmarks/github.com.png) so every mention/bookmark of the same
// site reuses one file. If a file with that name already exists it is reused.
func (v *Vault) SaveFaviconImage(host string, data []byte, ext string) (string, error) {
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	if !downloadableImageExt[ext] {
		return "", errors.New("unsupported image type")
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	base := sanitize(strings.TrimSpace(host))
	if base == "" || base == "Untitled" {
		base = "favicon"
	}
	return v.saveAssetNamed("Bookmarks", base, data, ext)
}

func (v *Vault) SaveVideo(name string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("video must not be empty")
	}
	if maxVideoBytes > 0 && len(data) > maxVideoBytes {
		return "", errors.New("video is larger than the configured limit")
	}
	if strings.ToLower(filepath.Ext(name)) != ".mp4" {
		return "", errors.New("only .mp4 video uploads are supported")
	}
	return v.saveAsset("Videos", name, data, ".mp4")
}

func (v *Vault) DeleteAsset(rel string) error {
	clean, full, err := v.resolveAssetPath(rel)
	if err != nil {
		return err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("asset must be a regular file")
	}
	if err := os.Remove(full); err != nil {
		return err
	}
	_ = clean
	return nil
}

func (v *Vault) AssetFullPath(rel string) (string, error) {
	_, full, err := v.resolveAssetPath(rel)
	return full, err
}

func (v *Vault) saveAsset(kind, originalName string, data []byte, ext string) (string, error) {
	dirRel := filepath.ToSlash(filepath.Join(assetRootDir, kind))
	dir, err := v.resolve(dirRel, true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := sanitize(strings.TrimSuffix(originalName, filepath.Ext(originalName)))
	fname := fmt.Sprintf("%s-%s%s", base, time.Now().Format("2006-01-02-150405"), ext)
	rel := filepath.ToSlash(filepath.Join(dirRel, fname))
	full, err := v.uniqueAssetPath(rel)
	if err != nil {
		return "", err
	}
	if err := atomicWriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	actualRel, err := filepath.Rel(v.Root, full)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(actualRel), nil
}

// saveAssetContentAddressed stores bytes under a filename derived from their
// SHA-256 hash, so identical content (e.g. the same site's favicon or a shared
// og:image pasted many times) is written only once. If a file with that hash
// already exists it is reused as-is, returning its existing vault-relative path.
func (v *Vault) saveAssetContentAddressed(kind string, data []byte, ext string) (string, error) {
	dirRel := filepath.ToSlash(filepath.Join(assetRootDir, kind))
	dir, err := v.resolve(dirRel, true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:])[:32] + ext
	rel := filepath.ToSlash(filepath.Join(dirRel, name))
	full, err := v.resolve(rel, true)
	if err != nil {
		return "", err
	}
	if info, statErr := os.Stat(full); statErr == nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("asset path is not a regular file")
		}
		// Identical content already downloaded — reuse it.
		actualRel, relErr := filepath.Rel(v.Root, full)
		if relErr != nil {
			return "", relErr
		}
		return filepath.ToSlash(actualRel), nil
	}
	if err := atomicWriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	actualRel, err := filepath.Rel(v.Root, full)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(actualRel), nil
}

// saveAssetNamed writes data to a fixed, readable filename (base+ext) and reuses
// an existing file of that name rather than creating a timestamped duplicate.
// Used for content that is one-per-name, like host-based favicons.
func (v *Vault) saveAssetNamed(kind, base string, data []byte, ext string) (string, error) {
	dirRel := filepath.ToSlash(filepath.Join(assetRootDir, kind))
	dir, err := v.resolve(dirRel, true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	rel := filepath.ToSlash(filepath.Join(dirRel, base+ext))
	full, err := v.resolve(rel, true)
	if err != nil {
		return "", err
	}
	if info, statErr := os.Stat(full); statErr == nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("asset path is not a regular file")
		}
		actualRel, relErr := filepath.Rel(v.Root, full)
		if relErr != nil {
			return "", relErr
		}
		return filepath.ToSlash(actualRel), nil
	}
	if err := atomicWriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	actualRel, err := filepath.Rel(v.Root, full)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(actualRel), nil
}

func (v *Vault) uniqueAssetPath(rel string) (string, error) {
	ext := filepath.Ext(rel)
	base := strings.TrimSuffix(rel, ext)
	for i := 0; ; i++ {
		candidate := rel
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d%s", base, i+1, ext)
		}
		full, err := v.resolve(candidate, true)
		if err != nil {
			return "", err
		}
		if _, err := os.Stat(full); errors.Is(err, os.ErrNotExist) {
			return full, nil
		} else if err != nil {
			return "", err
		}
	}
}

func (v *Vault) resolveAssetPath(rel string) (string, string, error) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(rel)))
	if !strings.HasPrefix(clean, "Assets/Images/") &&
		!strings.HasPrefix(clean, "Assets/Videos/") &&
		!strings.HasPrefix(clean, "Assets/Bookmarks/") {
		return "", "", errors.New("asset must be inside Assets/Images, Assets/Videos, or Assets/Bookmarks")
	}
	full, err := v.resolve(clean, true)
	return clean, full, err
}
