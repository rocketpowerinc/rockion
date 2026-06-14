package model

// VaultInfo describes an opened vault.
type VaultInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// TreeNode is a folder or note in the sidebar tree.
type TreeNode struct {
	Name      string     `json:"name"`
	Path      string     `json:"path"`                // vault-relative
	EntryPath string     `json:"entryPath,omitempty"` // note opened when a folder is clicked
	IsDir     bool       `json:"isDir"`
	Icon      string     `json:"icon,omitempty"` // emoji, for notes
	Children  []TreeNode `json:"children,omitempty"`
}

// PageCover describes a decorative page header. Image values are
// vault-relative asset paths.
type PageCover struct {
	Kind     string `json:"kind"`
	Value    string `json:"value"`
	Position int    `json:"position"`
}

// Note is a markdown file with parsed metadata.
type Note struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	PageID      string         `json:"pageId,omitempty"`
	Icon        string         `json:"icon,omitempty"`
	Cover       *PageCover     `json:"cover,omitempty"`
	Markdown    string         `json:"markdown"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	CreatedAt   int64          `json:"createdAt"`
	ModifiedAt  int64          `json:"modifiedAt"`
	Version     string         `json:"version"`
}

// SearchHit is a single search/backlink result.
type SearchHit struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Snippet string `json:"snippet,omitempty"`
}

// PageCard is a dashboard "gallery card" view of a managed page. It is derived
// entirely from the page file + sidecar metadata, so nothing card-specific is
// stored in the dashboard markdown.
type PageCard struct {
	PageID     string     `json:"pageId"`
	Path       string     `json:"path"`
	Title      string     `json:"title"`
	Icon       string     `json:"icon,omitempty"`
	Cover      *PageCover `json:"cover,omitempty"`
	CreatedAt  int64      `json:"createdAt"`
	ModifiedAt int64      `json:"modifiedAt"`
}

// DashboardView is the persisted view configuration for a dashboard. It lives
// in Rockion's dashboard-view sidecar so user frontmatter is not rewritten.
type DashboardView struct {
	View    string `json:"view"`              // gallery | list
	SortBy  string `json:"sortBy,omitempty"`  // title | created | modified
	SortDir string `json:"sortDir,omitempty"` // asc | desc
}
