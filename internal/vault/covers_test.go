package vault

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
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
	asset, err := v.SaveImage("cover.png", encoded.Bytes())
	if err != nil {
		t.Fatal(err)
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
		{
			Kind:            "unsplash",
			Value:           "https://example.com/photo.jpg",
			Position:        50,
			AttributionName: "Photographer",
			AttributionURL:  "https://unsplash.com/@photographer",
			SourceURL:       "https://unsplash.com/photos/example",
		},
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
