package vault

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"os"
	"strings"
	"testing"

	"rockion/internal/model"
)

func TestCoverLifecycleAndLocalImageLoading(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("note.md", "# Note\n"); err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 4, 2))
	img.Set(0, 0, color.RGBA{R: 200, G: 20, B: 40, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	asset, err := v.SaveCoverImage("cover.png", encoded.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(asset, "Assets/Covers/") {
		t.Fatalf("cover was not stored in cover assets folder: %s", asset)
	}
	cover := model.PageCover{Kind: "image", Value: asset, Position: 65}
	if err := v.SetCover("note.md", cover); err != nil {
		t.Fatal(err)
	}
	if got := v.Cover("note.md"); got == nil || got.Value != asset || got.Position != 65 {
		t.Fatalf("cover was not persisted: %#v", got)
	}
	dataURL, err := v.CoverImageDataURL("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected cover data URL: %q", dataURL)
	}
	thumbnailURL, err := v.CoverThumbnailDataURL("note.md")
	if err != nil {
		t.Fatal(err)
	}
	encodedThumbnail := strings.SplitN(thumbnailURL, ",", 2)
	if len(encodedThumbnail) != 2 {
		t.Fatalf("invalid thumbnail data URL: %q", thumbnailURL)
	}
	thumbnailBytes, err := base64.StdEncoding.DecodeString(encodedThumbnail[1])
	if err != nil {
		t.Fatal(err)
	}
	thumbnailConfig, _, err := image.DecodeConfig(bytes.NewReader(thumbnailBytes))
	if err != nil {
		t.Fatal(err)
	}
	if thumbnailConfig.Width > coverThumbnailWidth ||
		thumbnailConfig.Height > coverThumbnailHeight {
		t.Fatalf("thumbnail is too large: %dx%d", thumbnailConfig.Width, thumbnailConfig.Height)
	}

	if err := v.Rename("note.md", "renamed.md"); err != nil {
		t.Fatal(err)
	}
	if err := v.RenameCoverPath("note.md", "renamed.md", false); err != nil {
		t.Fatal(err)
	}
	if v.Cover("note.md") != nil || v.Cover("renamed.md") == nil {
		t.Fatal("cover metadata did not follow note rename")
	}
	if err := v.RemoveCoverPath("renamed.md", false); err != nil {
		t.Fatal(err)
	}
	if v.Cover("renamed.md") != nil {
		t.Fatal("cover metadata remains after removal")
	}
}

func TestCoverValidation(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("note.md", "# Note\n"); err != nil {
		t.Fatal(err)
	}
	for _, cover := range []model.PageCover{
		{Kind: "color", Value: "red", Position: 50},
		{Kind: "gradient", Value: "unknown", Position: 50},
		{Kind: "image", Value: "../outside.png", Position: 50},
		{Kind: "remote", Value: "https://example.com/photo.jpg", Position: 50},
	} {
		if err := v.SetCover("note.md", cover); err == nil {
			t.Fatalf("invalid cover was accepted: %#v", cover)
		}
	}
	if err := v.SetCover("note.md", model.PageCover{
		Kind:     "color",
		Value:    "#336699",
		Position: 50,
	}); err != nil {
		t.Fatal(err)
	}
	if err := v.SetCover("note.md", model.PageCover{}); err != nil {
		t.Fatal(err)
	}
	if v.Cover("note.md") != nil {
		t.Fatal("empty cover did not clear metadata")
	}
}

func TestCoverThumbnailCacheInvalidatesWhenAssetChanges(t *testing.T) {
	v := openTestVault(t)
	if err := v.Write("note.md", "# Note\n"); err != nil {
		t.Fatal(err)
	}
	first := image.NewRGBA(image.Rect(0, 0, 4, 2))
	first.Set(0, 0, color.RGBA{R: 255, A: 255})
	var firstBytes bytes.Buffer
	if err := png.Encode(&firstBytes, first); err != nil {
		t.Fatal(err)
	}
	asset, err := v.SaveCoverImage("cover.png", firstBytes.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := v.SetCover("note.md", model.PageCover{Kind: "image", Value: asset, Position: 50}); err != nil {
		t.Fatal(err)
	}
	thumb1, err := v.CoverThumbnailDataURL("note.md")
	if err != nil {
		t.Fatal(err)
	}
	thumb2, err := v.CoverThumbnailDataURL("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if thumb1 != thumb2 {
		t.Fatal("unchanged cover thumbnail was not stable")
	}

	second := image.NewRGBA(image.Rect(0, 0, 8, 4))
	second.Set(0, 0, color.RGBA{G: 255, A: 255})
	var secondBytes bytes.Buffer
	if err := png.Encode(&secondBytes, second); err != nil {
		t.Fatal(err)
	}
	full, err := v.AssetFullPath(asset)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, secondBytes.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	thumb3, err := v.CoverThumbnailDataURL("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if thumb3 == thumb1 {
		t.Fatal("cover thumbnail cache did not invalidate after asset replacement")
	}
}
