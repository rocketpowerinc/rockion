package main

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func TestValidateRemoteHostBlocksLocalNetworks(t *testing.T) {
	ctx := context.Background()
	for _, host := range []string{
		"localhost",
		"127.0.0.1",
		"::1",
		"10.0.0.2",
		"172.16.0.2",
		"192.168.1.1",
		"169.254.169.254",
		"fe80::1",
	} {
		if err := validateRemoteHost(ctx, host); err == nil {
			t.Fatalf("validateRemoteHost(%q) unexpectedly allowed local network host", host)
		}
	}
	if err := validateRemoteHost(ctx, "8.8.8.8"); err != nil {
		t.Fatalf("public IP was blocked: %v", err)
	}
}

func TestReadLimitedDownloadRejectsOversizedDownloads(t *testing.T) {
	got, err := readLimitedDownload(strings.NewReader("abc"), 3)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "abc" {
		t.Fatalf("readLimitedDownload = %q", got)
	}
	if _, err := readLimitedDownload(strings.NewReader("abcd"), 3); err == nil {
		t.Fatal("oversized download was not rejected")
	}
}

func TestFaviconCandidatesPreferFirstParty(t *testing.T) {
	page := mustParseURL(t, "https://example.com/docs/page")
	candidates := faviconCandidates(page)
	if len(candidates) < 2 {
		t.Fatalf("not enough candidates: %#v", candidates)
	}
	if candidates[0] != "https://example.com/favicon.ico" {
		t.Fatalf("first-party favicon was not first: %#v", candidates)
	}
	if !strings.Contains(candidates[len(candidates)-1], "google.com/s2/favicons") {
		t.Fatalf("Google fallback missing: %#v", candidates)
	}

	icon := mustParseURL(t, "https://cdn.example.com/icon.png")
	candidates = faviconCandidates(icon)
	if candidates[0] != "https://cdn.example.com/icon.png" {
		t.Fatalf("discovered favicon URL was not first: %#v", candidates)
	}
}

func TestImageExtFromBytesSniffsCommonWebFormats(t *testing.T) {
	cases := map[string][]byte{
		".png":  []byte("\x89PNG\r\n\x1a\nrest"),
		".jpg":  []byte{0xff, 0xd8, 0xff, 0x00},
		".gif":  []byte("GIF89arest"),
		".webp": []byte("RIFFxxxxWEBPrest"),
		".avif": []byte("\x00\x00\x00\x18ftypavifrest"),
		".ico":  []byte{0x00, 0x00, 0x01, 0x00},
	}
	for want, data := range cases {
		if got := imageExtFromBytes(data); got != want {
			t.Fatalf("imageExtFromBytes(%q) = %q, want %q", want, got, want)
		}
	}
	if got := imageExtFromBytes([]byte("not an image")); got != "" {
		t.Fatalf("unexpected image extension: %q", got)
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}
