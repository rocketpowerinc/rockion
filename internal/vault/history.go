package vault

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"rockion/internal/model"
)

const (
	historyDirName              = "history"
	saveHistorySnapshotInterval = 5 * time.Minute
)

type pageHistoryManifest struct {
	Path      string                     `json:"path"`
	Title     string                     `json:"title"`
	UpdatedAt int64                      `json:"updatedAt"`
	Versions  []model.PageHistoryVersion `json:"versions"`
}

func (v *Vault) historyRoot() string {
	return filepath.Join(v.Root, ".rockion", historyDirName, "pages")
}

func historyID(rel string) string {
	sum := sha256.Sum256([]byte(filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))))
	return hex.EncodeToString(sum[:])[:24]
}

func contentHash(markdown string) string {
	sum := sha256.Sum256([]byte(markdown))
	return hex.EncodeToString(sum[:])
}

func historyTitle(rel, markdown string) string {
	for _, line := range strings.Split(markdown, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			title := strings.TrimSpace(line[2:])
			if title != "" {
				return title
			}
		}
	}
	name := strings.TrimSuffix(filepath.Base(filepath.FromSlash(rel)), filepath.Ext(rel))
	if name == "" {
		return "Untitled"
	}
	return name
}

func cleanHistoryReason(reason string) string {
	reason = strings.ToLower(strings.TrimSpace(reason))
	reason = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		if r == ' ' {
			return '-'
		}
		return -1
	}, reason)
	reason = strings.Trim(reason, "-_")
	if reason == "" {
		return "save"
	}
	return reason
}

func (v *Vault) historyPageDir(rel string) string {
	return filepath.Join(v.historyRoot(), historyID(rel))
}

func historyManifestPath(dir string) string {
	return filepath.Join(dir, "manifest.json")
}

func (v *Vault) readHistoryManifest(dir string) (pageHistoryManifest, error) {
	data, err := os.ReadFile(historyManifestPath(dir))
	if errors.Is(err, os.ErrNotExist) {
		return pageHistoryManifest{}, nil
	}
	if err != nil {
		return pageHistoryManifest{}, err
	}
	var manifest pageHistoryManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return pageHistoryManifest{}, err
	}
	return manifest, nil
}

func writeHistoryManifest(dir string, manifest pageHistoryManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(historyManifestPath(dir), append(data, '\n'), 0o644)
}

// RecordHistorySnapshot stores the current user-visible markdown body for a
// page. Duplicate consecutive content hashes are skipped.
func (v *Vault) RecordHistorySnapshot(rel, markdown, reason string) (*model.PageHistoryVersion, error) {
	if err := requireUserPath(rel); err != nil {
		return nil, err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return nil, err
	}
	rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	hash := contentHash(markdown)
	reason = cleanHistoryReason(reason)

	v.historyMu.Lock()
	defer v.historyMu.Unlock()

	dir := v.historyPageDir(rel)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	manifest, err := v.readHistoryManifest(dir)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if n := len(manifest.Versions); n > 0 {
		latest := manifest.Versions[n-1]
		if latest.Hash == hash || shouldThrottleHistorySnapshot(latest, reason, now) {
			return nil, nil
		}
	}

	id := fmt.Sprintf("%s-%s.md", now.Format("20060102T150405.000000000Z"), reason)
	version := model.PageHistoryVersion{
		ID:        id,
		Path:      rel,
		Title:     historyTitle(rel, markdown),
		Reason:    reason,
		CreatedAt: now.UnixMilli(),
		Hash:      hash,
		Size:      int64(len([]byte(markdown))),
	}
	if err := atomicWriteFile(filepath.Join(dir, id), []byte(markdown), 0o644); err != nil {
		return nil, err
	}
	manifest.Path = rel
	manifest.Title = version.Title
	manifest.UpdatedAt = version.CreatedAt
	manifest.Versions = append(manifest.Versions, version)
	if err := writeHistoryManifest(dir, manifest); err != nil {
		return nil, err
	}
	return &version, nil
}

func shouldThrottleHistorySnapshot(
	latest model.PageHistoryVersion,
	reason string,
	now time.Time,
) bool {
	if reason != "save" || latest.Reason != "save" || latest.CreatedAt <= 0 {
		return false
	}
	return now.Sub(time.UnixMilli(latest.CreatedAt)) < saveHistorySnapshotInterval
}

func (v *Vault) ListPageHistory(rel string) ([]model.PageHistoryVersion, error) {
	if err := requireUserPath(rel); err != nil {
		return nil, err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return nil, err
	}
	v.historyMu.Lock()
	defer v.historyMu.Unlock()
	manifest, err := v.readHistoryManifest(v.historyPageDir(rel))
	if err != nil {
		return nil, err
	}
	versions := append([]model.PageHistoryVersion(nil), manifest.Versions...)
	sort.SliceStable(versions, func(i, j int) bool {
		return versions[i].CreatedAt > versions[j].CreatedAt
	})
	return versions, nil
}

func (v *Vault) ReadHistoryVersion(rel, id string) (string, error) {
	if err := requireUserPath(rel); err != nil {
		return "", err
	}
	if err := requireMarkdownPath(rel); err != nil {
		return "", err
	}
	if strings.ContainsAny(id, `/\`) || strings.HasPrefix(id, ".") || !strings.HasSuffix(id, ".md") {
		return "", errors.New("invalid history version")
	}
	v.historyMu.Lock()
	defer v.historyMu.Unlock()
	manifest, err := v.readHistoryManifest(v.historyPageDir(rel))
	if err != nil {
		return "", err
	}
	found := false
	for _, version := range manifest.Versions {
		if version.ID == id {
			found = true
			break
		}
	}
	if !found {
		return "", os.ErrNotExist
	}
	data, err := os.ReadFile(filepath.Join(v.historyPageDir(rel), id))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (v *Vault) RecentHistory(limit int) ([]model.PageHistorySummary, error) {
	if limit <= 0 {
		limit = 6
	}
	root := v.historyRoot()
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return []model.PageHistorySummary{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := []model.PageHistorySummary{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		manifest, err := v.readHistoryManifest(filepath.Join(root, entry.Name()))
		if err != nil || len(manifest.Versions) == 0 {
			continue
		}
		items = append(items, model.PageHistorySummary{
			Path:      manifest.Path,
			Title:     manifest.Title,
			UpdatedAt: manifest.UpdatedAt,
			Count:     len(manifest.Versions),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].UpdatedAt > items[j].UpdatedAt
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (v *Vault) ClearHistory() error {
	v.historyMu.Lock()
	defer v.historyMu.Unlock()
	return os.RemoveAll(filepath.Join(v.Root, ".rockion", historyDirName))
}

func (v *Vault) RenameHistoryPath(oldRel, newRel string, isDir bool) error {
	oldRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(oldRel)))
	newRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(newRel)))
	v.historyMu.Lock()
	defer v.historyMu.Unlock()

	root := v.historyRoot()
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var errs []error
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		manifest, err := v.readHistoryManifest(dir)
		if err != nil || manifest.Path == "" {
			errs = append(errs, err)
			continue
		}
		updatedPath, changed := renamedHistoryPath(manifest.Path, oldRel, newRel, isDir)
		if !changed {
			continue
		}
		newDir := filepath.Join(root, historyID(updatedPath))
		manifest.Path = updatedPath
		manifest.Title = titleFromPathFallback(manifest.Title, updatedPath)
		for i := range manifest.Versions {
			manifest.Versions[i].Path = updatedPath
		}
		if dir != newDir {
			if _, statErr := os.Stat(newDir); errors.Is(statErr, os.ErrNotExist) {
				if renameErr := os.Rename(dir, newDir); renameErr != nil {
					errs = append(errs, renameErr)
					continue
				}
				dir = newDir
			} else if statErr != nil {
				errs = append(errs, statErr)
				continue
			} else {
				if mergeErr := mergeHistoryDirs(dir, newDir, manifest); mergeErr != nil {
					errs = append(errs, mergeErr)
				}
				continue
			}
		}
		if err := writeHistoryManifest(dir, manifest); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func mergeHistoryDirs(fromDir, toDir string, manifest pageHistoryManifest) error {
	target, err := (&Vault{}).readHistoryManifest(toDir)
	if err != nil {
		return err
	}
	existing := map[string]bool{}
	for _, version := range target.Versions {
		existing[version.ID] = true
	}
	for i, version := range manifest.Versions {
		id := version.ID
		if existing[id] {
			id = uniqueHistoryVersionID(id, existing)
			manifest.Versions[i].ID = id
		}
		data, err := os.ReadFile(filepath.Join(fromDir, version.ID))
		if err != nil {
			return err
		}
		if err := atomicWriteFile(filepath.Join(toDir, id), data, 0o644); err != nil {
			return err
		}
		existing[id] = true
	}
	target.Path = manifest.Path
	if manifest.Title != "" {
		target.Title = manifest.Title
	}
	target.Versions = append(target.Versions, manifest.Versions...)
	sort.SliceStable(target.Versions, func(i, j int) bool {
		return target.Versions[i].CreatedAt < target.Versions[j].CreatedAt
	})
	for _, version := range target.Versions {
		if version.CreatedAt > target.UpdatedAt {
			target.UpdatedAt = version.CreatedAt
		}
	}
	if err := writeHistoryManifest(toDir, target); err != nil {
		return err
	}
	return os.RemoveAll(fromDir)
}

func uniqueHistoryVersionID(id string, existing map[string]bool) string {
	ext := filepath.Ext(id)
	base := strings.TrimSuffix(id, ext)
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", base, i, ext)
		if !existing[candidate] {
			return candidate
		}
	}
}

func renamedHistoryPath(path, oldRel, newRel string, isDir bool) (string, bool) {
	if !isDir {
		if path == oldRel {
			return newRel, true
		}
		return path, false
	}
	prefix := strings.TrimSuffix(oldRel, "/") + "/"
	if path == oldRel {
		return newRel, true
	}
	if strings.HasPrefix(path, prefix) {
		return strings.TrimSuffix(newRel, "/") + "/" + strings.TrimPrefix(path, prefix), true
	}
	return path, false
}

func titleFromPathFallback(title, rel string) string {
	if strings.TrimSpace(title) != "" {
		return title
	}
	return historyTitle(rel, "")
}
