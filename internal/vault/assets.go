package vault

import (
	"bytes"
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
	if !strings.HasPrefix(clean, "Assets/Images/") && !strings.HasPrefix(clean, "Assets/Videos/") {
		return "", "", errors.New("asset must be inside Assets/Images or Assets/Videos")
	}
	full, err := v.resolve(clean, true)
	return clean, full, err
}
