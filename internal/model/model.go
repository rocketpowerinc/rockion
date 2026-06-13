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

// Note is a markdown file with parsed metadata.
type Note struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	PageID      string         `json:"pageId,omitempty"`
	Icon        string         `json:"icon,omitempty"`
	Markdown    string         `json:"markdown"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	ModifiedAt  int64          `json:"modifiedAt"`
	Version     string         `json:"version"`
}

// SearchHit is a single search/backlink result.
type SearchHit struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Snippet string `json:"snippet,omitempty"`
}
