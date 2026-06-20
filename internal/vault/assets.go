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
const maxAudioBytes = 0

// SaveImage writes validated image bytes into Assets/Images/ and returns the
// vault-relative path. PNG/JPEG/GIF are strictly decoded; WebP and AVIF — which
// the Go stdlib can't decode but the WebView renders — are accepted by
// magic-byte validation instead.
func (v *Vault) SaveImage(name string, data []byte) (string, error) {
	rel, err := v.saveValidatedImage("Images", name, data)
	if err == nil {
		return rel, nil
	}
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	for _, ext := range []string{".webp", ".avif"} {
		if downloadableImageBytesMatch(data, ext) {
			return v.saveAsset("Images", name, data, ext)
		}
	}
	return "", err
}

// SaveIconImage writes validated icon image bytes into Assets/Icons/ and
// returns the vault-relative path. Icons are kept separate from regular embedded
// page images so vault media stays easier to browse and clean up.
func (v *Vault) SaveIconImage(name string, data []byte) (string, error) {
	return v.saveValidatedImage("Icons", name, data)
}

// SaveCoverImage writes validated cover image bytes into Assets/Covers/ and
// returns the vault-relative path. Covers are kept separate from embedded page
// images because they are referenced from .rockion/covers.json, not Markdown.
func (v *Vault) SaveCoverImage(name string, data []byte) (string, error) {
	return v.saveValidatedImage("Covers", name, data)
}

func (v *Vault) saveValidatedImage(kind, name string, data []byte) (string, error) {
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
	return v.saveAsset(kind, name, data, ext)
}

var downloadableImageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".avif": true, ".ico": true,
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
	if !downloadableImageBytesMatch(data, ext) {
		return "", errors.New("invalid image data")
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	return v.saveAssetContentAddressed("Bookmarks", data, ext)
}

// SaveFaviconImage stores a site favicon under a content-addressed name in
// Assets/Bookmarks so every mention/bookmark with identical favicon bytes reuses
// one file.
func (v *Vault) SaveFaviconImage(host string, data []byte, ext string) (string, error) {
	if len(data) == 0 || len(data) > maxImageBytes {
		return "", fmt.Errorf("image must be between 1 byte and %d MB", maxImageBytes>>20)
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	if !downloadableImageExt[ext] {
		return "", errors.New("unsupported image type")
	}
	if !downloadableImageBytesMatch(data, ext) {
		return "", errors.New("invalid image data")
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	_ = host
	return v.saveAssetContentAddressed("Bookmarks", data, ext)
}

func downloadableImageBytesMatch(data []byte, ext string) bool {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == ".jpeg" {
		ext = ".jpg"
	}
	switch ext {
	case ".png":
		return len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n"
	case ".jpg":
		return len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff
	case ".gif":
		return len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a")
	case ".webp":
		return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	case ".avif":
		return len(data) >= 12 && string(data[4:8]) == "ftyp" && strings.Contains(string(data[8:min(len(data), 32)]), "avif")
	case ".ico":
		return len(data) >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0x01 && data[3] == 0x00
	default:
		return false
	}
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

var allowedAudioExt = map[string]bool{
	".mp3": true, ".wav": true, ".ogg": true, ".oga": true, ".m4a": true,
	".aac": true, ".flac": true, ".opus": true, ".weba": true,
}

// SaveAudio writes an uploaded audio file into Assets/Audio/ and returns the
// vault-relative path. Like SaveVideo it trusts the extension (the bytes are
// played by the browser), accepting the common web-playable audio containers.
func (v *Vault) SaveAudio(name string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("audio must not be empty")
	}
	if maxAudioBytes > 0 && len(data) > maxAudioBytes {
		return "", errors.New("audio is larger than the configured limit")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if !allowedAudioExt[ext] {
		return "", errors.New("unsupported audio format")
	}
	return v.saveAsset("Audio", name, data, ext)
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

func (v *Vault) DeleteUnusedBookmarkAssets(paths []string) ([]string, error) {
	seen := make(map[string]struct{})
	var candidates []string
	for _, path := range paths {
		clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
		if !strings.HasPrefix(clean, "Assets/Bookmarks/") {
			return nil, errors.New("bookmark cleanup only accepts Assets/Bookmarks assets")
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		if _, _, err := v.resolveAssetPath(clean); err != nil {
			return nil, err
		}
		seen[clean] = struct{}{}
		candidates = append(candidates, clean)
	}
	if len(candidates) == 0 {
		return nil, nil
	}

	referenced := make(map[string]bool)
	err := filepath.WalkDir(v.Root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == ".rockion" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(data)
		for _, candidate := range candidates {
			if strings.Contains(text, candidate) {
				referenced[candidate] = true
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	var deleted []string
	for _, candidate := range candidates {
		if referenced[candidate] {
			continue
		}
		if err := v.DeleteAsset(candidate); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return deleted, err
		}
		deleted = append(deleted, candidate)
	}
	return deleted, nil
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
// Used for content that is one-per-name.
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
		!strings.HasPrefix(clean, "Assets/Icons/") &&
		!strings.HasPrefix(clean, "Assets/Covers/") &&
		!strings.HasPrefix(clean, "Assets/Videos/") &&
		!strings.HasPrefix(clean, "Assets/Audio/") &&
		!strings.HasPrefix(clean, "Assets/Bookmarks/") {
		return "", "", errors.New("asset must be inside Assets/Images, Assets/Icons, Assets/Covers, Assets/Videos, Assets/Audio, or Assets/Bookmarks")
	}
	full, err := v.resolve(clean, true)
	return clean, full, err
}
