package vault

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"rockion/internal/model"
)

const (
	maxCoverSidecarBytes = 4 << 20
	maxCoverImagePixels  = 40_000_000
	coverThumbnailWidth  = 640
	coverThumbnailHeight = 360
	maxCoverThumbCache   = 128
)

var coverColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var allowedCoverGradients = map[string]struct{}{
	"aurora":   {},
	"citrus":   {},
	"ember":    {},
	"lagoon":   {},
	"lavender": {},
	"midnight": {},
	"peach":    {},
	"rose":     {},
}

func (v *Vault) coversPath() string {
	return filepath.Join(v.Root, ".rockion", "covers.json")
}

// Cover returns a page's decorative cover metadata.
func (v *Vault) Cover(rel string) *model.PageCover {
	v.coversMu.Lock()
	defer v.coversMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	cover, ok := v.readCovers()[rel]
	if !ok || !supportedCoverKind(cover.Kind) {
		return nil
	}
	copy := cover
	return &copy
}

// SetCover sets or clears a page cover. An empty Kind clears it.
func (v *Vault) SetCover(rel string, cover model.PageCover) error {
	if _, err := v.Read(rel); err != nil {
		return err
	}
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	if cover.Kind != "" {
		if err := v.validateCover(cover); err != nil {
			return err
		}
	}

	v.coversMu.Lock()
	defer v.coversMu.Unlock()
	covers := v.readCovers()
	if cover.Kind == "" {
		delete(covers, rel)
	} else {
		covers[rel] = cover
	}
	return v.writeCovers(covers)
}

// CoverImageDataURL returns a validated local cover image for display in the
// Wails webview.
func (v *Vault) CoverImageDataURL(rel string) (string, error) {
	cover := v.Cover(rel)
	if cover == nil || cover.Kind != "image" {
		return "", errors.New("page does not have a local image cover")
	}
	full, format, err := v.validateCoverAsset(cover.Value)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	mime := map[string]string{
		"gif":  "image/gif",
		"jpeg": "image/jpeg",
		"png":  "image/png",
	}[format]
	if mime == "" {
		return "", errors.New("unsupported cover image format")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// CoverThumbnailDataURL returns a bounded preview for dashboard cards. It
// avoids transferring full-size cover files through the Wails bridge.
func (v *Vault) CoverThumbnailDataURL(rel string) (string, error) {
	cover := v.Cover(rel)
	if cover == nil || cover.Kind != "image" {
		return "", errors.New("page does not have a local image cover")
	}
	full, _, err := v.validateCoverAsset(cover.Value)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", err
	}
	cacheKey := coverThumbnailCacheKey(full, info)
	if cached := v.cachedCoverThumbnail(cacheKey); cached != "" {
		return cached, nil
	}
	file, err := os.Open(full)
	if err != nil {
		return "", err
	}
	source, format, err := image.Decode(file)
	closeErr := file.Close()
	if err != nil {
		return "", errors.New("cover image could not be decoded")
	}
	if closeErr != nil {
		return "", closeErr
	}

	bounds := source.Bounds()
	width, height := thumbnailDimensions(bounds.Dx(), bounds.Dy())
	thumbnail := image.NewRGBA(image.Rect(0, 0, width, height))
	scaleThumbnail(thumbnail, source)

	var encoded bytes.Buffer
	mime := "image/jpeg"
	if format == "png" || format == "gif" {
		mime = "image/png"
		err = png.Encode(&encoded, thumbnail)
	} else {
		err = jpeg.Encode(&encoded, thumbnail, &jpeg.Options{Quality: 78})
	}
	if err != nil {
		return "", err
	}
	dataURL := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	v.storeCoverThumbnail(cacheKey, dataURL)
	return dataURL, nil
}

func coverThumbnailCacheKey(full string, info os.FileInfo) string {
	return fmt.Sprintf("%s:%d:%d", full, info.Size(), info.ModTime().UnixNano())
}

func (v *Vault) cachedCoverThumbnail(key string) string {
	v.coverThumbMu.Lock()
	defer v.coverThumbMu.Unlock()
	return v.coverThumbs[key]
}

func (v *Vault) storeCoverThumbnail(key, dataURL string) {
	v.coverThumbMu.Lock()
	defer v.coverThumbMu.Unlock()
	if v.coverThumbs == nil {
		v.coverThumbs = map[string]string{}
	}
	if len(v.coverThumbs) >= maxCoverThumbCache {
		for existing := range v.coverThumbs {
			delete(v.coverThumbs, existing)
			break
		}
	}
	v.coverThumbs[key] = dataURL
}

func (v *Vault) RenameCoverPath(oldRel, newRel string, isDir bool) error {
	v.coversMu.Lock()
	defer v.coversMu.Unlock()
	oldRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(oldRel)))
	newRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(newRel)))
	covers := v.readCovers()
	changed := false
	for path, cover := range covers {
		mapped, ok := mapRenamedPath(path, oldRel, newRel, isDir)
		if !ok {
			continue
		}
		delete(covers, path)
		covers[mapped] = cover
		changed = true
	}
	if !changed {
		return nil
	}
	return v.writeCovers(covers)
}

func (v *Vault) RemoveCoverPath(rel string, isDir bool) error {
	v.coversMu.Lock()
	defer v.coversMu.Unlock()
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	covers := v.readCovers()
	changed := false
	for path := range covers {
		if path == rel || (isDir && strings.HasPrefix(path, rel+"/")) {
			delete(covers, path)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return v.writeCovers(covers)
}

func (v *Vault) validateCover(cover model.PageCover) error {
	if cover.Position < 0 || cover.Position > 100 {
		return errors.New("cover position must be between 0 and 100")
	}
	switch cover.Kind {
	case "color":
		if !coverColorPattern.MatchString(cover.Value) {
			return errors.New("cover color must be a six-digit hex color")
		}
	case "gradient":
		if _, ok := allowedCoverGradients[cover.Value]; !ok {
			return errors.New("unknown cover gradient")
		}
	case "image":
		if _, _, err := v.validateCoverAsset(cover.Value); err != nil {
			return err
		}
	default:
		return errors.New("unknown cover type")
	}
	return nil
}

func supportedCoverKind(kind string) bool {
	return kind == "color" || kind == "gradient" || kind == "image"
}

func (v *Vault) validateCoverAsset(rel string) (string, string, error) {
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	if !strings.HasPrefix(clean, "Assets/Covers/") &&
		!strings.HasPrefix(clean, "Assets/Images/") {
		return "", "", errors.New("cover image must be stored in the vault cover assets folder")
	}
	full, err := v.resolve(clean, false)
	if err != nil {
		return "", "", err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return "", "", err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", "", errors.New("cover image must be a regular file")
	}
	if info.Size() <= 0 || info.Size() > 10<<20 {
		return "", "", errors.New("cover image must be 10 MB or smaller")
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", "", err
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 ||
		config.Width > 12000 || config.Height > 12000 ||
		config.Width > maxCoverImagePixels/config.Height {
		return "", "", errors.New("cover image is invalid or too large")
	}
	switch format {
	case "gif", "jpeg", "png":
		return full, format, nil
	default:
		return "", "", fmt.Errorf("unsupported cover image format: %s", format)
	}
}

func thumbnailDimensions(width, height int) (int, int) {
	if width <= coverThumbnailWidth && height <= coverThumbnailHeight {
		return width, height
	}
	scaleWidth := float64(coverThumbnailWidth) / float64(width)
	scaleHeight := float64(coverThumbnailHeight) / float64(height)
	scale := min(scaleWidth, scaleHeight)
	return max(1, int(float64(width)*scale)), max(1, int(float64(height)*scale))
}

func scaleThumbnail(destination *image.RGBA, source image.Image) {
	sourceBounds := source.Bounds()
	targetBounds := destination.Bounds()
	for y := targetBounds.Min.Y; y < targetBounds.Max.Y; y++ {
		sourceY := sourceBounds.Min.Y +
			(y-targetBounds.Min.Y)*sourceBounds.Dy()/targetBounds.Dy()
		for x := targetBounds.Min.X; x < targetBounds.Max.X; x++ {
			sourceX := sourceBounds.Min.X +
				(x-targetBounds.Min.X)*sourceBounds.Dx()/targetBounds.Dx()
			destination.Set(x, y, source.At(sourceX, sourceY))
		}
	}
}

func (v *Vault) readCovers() map[string]model.PageCover {
	covers := map[string]model.PageCover{}
	info, err := os.Lstat(v.coversPath())
	if err != nil || info.Mode()&os.ModeSymlink != 0 ||
		!info.Mode().IsRegular() || info.Size() > maxCoverSidecarBytes {
		return covers
	}
	data, err := os.ReadFile(v.coversPath())
	if err != nil {
		return covers
	}
	if err := json.Unmarshal(data, &covers); err != nil {
		return map[string]model.PageCover{}
	}
	return covers
}

func (v *Vault) writeCovers(covers map[string]model.PageCover) error {
	if err := v.ensureMetadataDir(); err != nil {
		return err
	}
	if info, err := os.Lstat(v.coversPath()); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("covers sidecar cannot be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(covers, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > maxCoverSidecarBytes {
		return errors.New("covers sidecar exceeds the 4 MB limit")
	}
	return atomicWriteFile(v.coversPath(), data, 0o644)
}
