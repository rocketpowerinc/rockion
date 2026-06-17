package main

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
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
const maxRemoteImageBytes = 10 << 20
const maxRemoteFaviconBytes = 2 << 20

// FetchLinkPreview downloads a page and extracts Open Graph / title / favicon
// metadata. On any network error it still returns a best-effort preview (host as
// title) so the UI can fall back gracefully.
func (a *App) FetchLinkPreview(rawURL string) (LinkPreview, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return LinkPreview{}, errors.New("a valid http(s) URL is required")
	}
	if err := validateRemoteURL(u); err != nil {
		return LinkPreview{}, err
	}
	fallback := LinkPreview{URL: u.String(), Title: u.Host, SiteName: u.Host, Favicon: defaultFavicon(u)}

	client := safeHTTPClient(8 * time.Second)
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
	if err := validateRemoteURL(u); err != nil {
		return "", err
	}
	client := safeHTTPClient(12 * time.Second)
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
	data, err := readLimitedDownload(resp.Body, maxRemoteImageBytes)
	if err != nil {
		return "", err
	}
	ext := imageExtFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = strings.ToLower(path.Ext(u.Path))
	}
	if sniffed := imageExtFromBytes(data); sniffed != "" {
		ext = sniffed
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

// SaveFavicon downloads a site favicon and stores it under a readable,
// host-based name (e.g. github.com.png), reused across every link to that site.
// If rawURL already points at a favicon discovered from the page, that exact URL
// is tried first; otherwise the site's own /favicon.ico is tried before falling
// back to Google's favicon service.
func (a *App) SaveFavicon(rawURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("a valid http(s) URL is required")
	}
	if err := validateRemoteURL(u); err != nil {
		return "", err
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if host == "" {
		return "", errors.New("a valid host is required")
	}

	data, ext, err := downloadFirstFavicon(u)
	if err != nil {
		return "", err
	}

	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.requireVault(); err != nil {
		return "", err
	}
	return a.vault.SaveFaviconImage(host, data, ext)
}

func safeHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
				host, _, err := net.SplitHostPort(address)
				if err != nil {
					return nil, err
				}
				if err := validateRemoteHost(ctx, host); err != nil {
					return nil, err
				}
				var dialer net.Dialer
				return dialer.DialContext(ctx, network, address)
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return validateRemoteURL(req.URL)
		},
	}
}

func validateRemoteURL(u *url.URL) error {
	if u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("a valid http(s) URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return validateRemoteHost(ctx, u.Hostname())
}

func validateRemoteHost(ctx context.Context, host string) error {
	host = strings.TrimSpace(strings.TrimSuffix(host, "."))
	if host == "" {
		return errors.New("a valid host is required")
	}
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") || strings.HasSuffix(lower, ".local") {
		return errors.New("local network URLs are not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicRemoteIP(ip) {
			return errors.New("local network URLs are not allowed")
		}
		return nil
	}
	resolver := net.DefaultResolver
	ips, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return errors.New("host did not resolve")
	}
	for _, resolved := range ips {
		if !isPublicRemoteIP(resolved.IP) {
			return errors.New("local network URLs are not allowed")
		}
	}
	return nil
}

func isPublicRemoteIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return !(ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified())
}

func readLimitedDownload(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("download is larger than %d MB", max>>20)
	}
	return data, nil
}

func downloadFirstFavicon(pageOrIcon *url.URL) ([]byte, string, error) {
	candidates := faviconCandidates(pageOrIcon)
	client := safeHTTPClient(12 * time.Second)
	var lastErr error
	for _, candidate := range candidates {
		data, ext, err := downloadImage(client, candidate, maxRemoteFaviconBytes)
		if err == nil {
			return data, ext, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, "", lastErr
	}
	return nil, "", errors.New("favicon download failed")
}

func faviconCandidates(pageOrIcon *url.URL) []string {
	firstParty := *pageOrIcon
	firstParty.Path = "/favicon.ico"
	firstParty.RawQuery = ""
	firstParty.Fragment = ""

	candidates := []string{}
	if looksLikeImagePath(pageOrIcon.Path) {
		candidates = append(candidates, pageOrIcon.String())
	}
	candidates = append(candidates, firstParty.String())
	host := strings.TrimPrefix(strings.ToLower(pageOrIcon.Hostname()), "www.")
	if host != "" {
		candidates = append(candidates, "https://www.google.com/s2/favicons?sz=64&domain="+url.QueryEscape(host))
	}
	return dedupeStrings(candidates)
}

func downloadImage(client *http.Client, src string, limit int64) ([]byte, string, error) {
	u, err := url.Parse(src)
	if err != nil {
		return nil, "", err
	}
	if err := validateRemoteURL(u); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; RockionLinkPreview/1.0)")
	req.Header.Set("Accept", "image/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("image download failed: %d", resp.StatusCode)
	}
	data, err := readLimitedDownload(resp.Body, limit)
	if err != nil {
		return nil, "", err
	}
	ext := firstNonEmpty(imageExtFromBytes(data), imageExtFromContentType(resp.Header.Get("Content-Type")), strings.ToLower(path.Ext(u.Path)))
	if ext == "" {
		return nil, "", errors.New("unsupported image type")
	}
	return data, ext, nil
}

func looksLikeImagePath(p string) bool {
	switch strings.ToLower(path.Ext(p)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico":
		return true
	default:
		return false
	}
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
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
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ".ico"
	default:
		return ""
	}
}

func imageExtFromBytes(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return ".png"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return ".jpg"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return ".gif"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return ".webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp" && strings.Contains(string(data[8:min(len(data), 32)]), "avif"):
		return ".avif"
	case len(data) >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0x01 && data[3] == 0x00:
		return ".ico"
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
