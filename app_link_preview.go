package main

import (
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

// LinkPreview is the metadata used to render a pasted link as a Mention (title)
// or a Bookmark card (title + description + image + favicon).
type LinkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Favicon     string `json:"favicon"`
	SiteName    string `json:"siteName"`
}

const maxPreviewBytes = 768 << 10

// FetchLinkPreview downloads a page and extracts Open Graph / title / favicon
// metadata. On any network error it still returns a best-effort preview (host as
// title) so the UI can fall back gracefully.
func (a *App) FetchLinkPreview(rawURL string) (LinkPreview, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return LinkPreview{}, errors.New("a valid http(s) URL is required")
	}
	fallback := LinkPreview{URL: u.String(), Title: u.Host, SiteName: u.Host, Favicon: defaultFavicon(u)}

	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return fallback, nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; RockionLinkPreview/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := client.Do(req)
	if err != nil {
		return fallback, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fallback, nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxPreviewBytes))
	page := string(body)

	preview := LinkPreview{URL: u.String()}
	preview.Title = firstNonEmpty(metaContent(page, "og:title"), titleTag(page), u.Host)
	preview.Description = firstNonEmpty(metaContent(page, "og:description"), metaContent(page, "description"))
	preview.SiteName = firstNonEmpty(metaContent(page, "og:site_name"), u.Host)
	preview.Image = absoluteURL(u, metaContent(page, "og:image"))
	preview.Favicon = firstNonEmpty(absoluteURL(u, faviconHref(page)), defaultFavicon(u))
	return preview, nil
}

// SaveRemoteImage downloads a remote image (e.g. a bookmark's og:image) and
// stores it as a local vault asset, returning the vault-relative path. This
// makes bookmark thumbnails reliable (no hotlink/CORS issues) and offline.
func (a *App) SaveRemoteImage(rawURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("a valid http(s) image URL is required")
	}
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; RockionLinkPreview/1.0)")
	req.Header.Set("Accept", "image/*")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("image download failed: %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", err
	}
	ext := imageExtFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = strings.ToLower(path.Ext(u.Path))
	}
	name := path.Base(u.Path)
	if name == "" || name == "." || name == "/" {
		name = "bookmark"
	}

	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveBookmarkImage(name, data, ext)
}

// SaveFavicon downloads the favicon for a page's host and stores it under a
// readable, host-based name (e.g. github.com.png), reused across every link to
// that site. Returns the vault-relative path.
func (a *App) SaveFavicon(rawURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("a valid http(s) URL is required")
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if host == "" {
		return "", errors.New("a valid host is required")
	}
	src := "https://www.google.com/s2/favicons?sz=64&domain=" + url.QueryEscape(host)

	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest(http.MethodGet, src, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; RockionLinkPreview/1.0)")
	req.Header.Set("Accept", "image/*")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("favicon download failed: %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return "", err
	}
	ext := imageExtFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = ".png"
	}

	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveFaviconImage(host, data, ext)
}

func imageExtFromContentType(contentType string) string {
	ct := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/avif":
		return ".avif"
	default:
		return ""
	}
}

var (
	contentRe  = regexp.MustCompile(`(?is)content\s*=\s*["']([^"']*)["']`)
	titleRe    = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	iconLinkRe = regexp.MustCompile(`(?is)<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>`)
	hrefRe     = regexp.MustCompile(`(?is)href\s*=\s*["']([^"']*)["']`)
)

func metaContent(page, key string) string {
	re := regexp.MustCompile(`(?is)<meta[^>]+(?:property|name)\s*=\s*["']` + regexp.QuoteMeta(key) + `["'][^>]*>`)
	tag := re.FindString(page)
	if tag == "" {
		return ""
	}
	m := contentRe.FindStringSubmatch(tag)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(html.UnescapeString(m[1]))
}

func titleTag(page string) string {
	m := titleRe.FindStringSubmatch(page)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(html.UnescapeString(m[1]))
}

func faviconHref(page string) string {
	tag := iconLinkRe.FindString(page)
	if tag == "" {
		return ""
	}
	m := hrefRe.FindStringSubmatch(tag)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(html.UnescapeString(m[1]))
}

func defaultFavicon(u *url.URL) string {
	return u.Scheme + "://" + u.Host + "/favicon.ico"
}

func absoluteURL(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	parsed, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(parsed)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
