package main

import (
	"net/http"
	"path"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// vaultAssetMiddleware serves vault media (Assets/Images, Assets/Videos) straight
// from the open vault. It must run as middleware — not as the asset-server
// fallback Handler — so it intercepts the request before Wails' dev proxy hands
// `/Assets/...` to Vite (whose SPA fallback would otherwise return index.html and
// break <img>/<video> sources). Every other request is passed through untouched.
func (a *App) vaultAssetMiddleware() assetserver.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
			isAsset := strings.HasPrefix(rel, "Assets/Images/") ||
				strings.HasPrefix(rel, "Assets/Videos/")
			if !isAsset {
				next.ServeHTTP(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

			a.mu.RLock()
			v := a.vault
			a.mu.RUnlock()
			if v == nil {
				http.NotFound(w, r)
				return
			}
			full, err := v.AssetFullPath(rel)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			// http.ServeFile supports Range requests, which <video> needs to seek.
			http.ServeFile(w, r, full)
		})
	}
}
