package search

import (
	"strings"

	"rockion/internal/db"
	"rockion/internal/model"
)

// Search runs full-text search over indexed notes.
type Search struct {
	db *db.DB
}

func New(d *db.DB) *Search {
	return &Search{db: d}
}

// VaultQuery returns all title matches first and at most contentLimit body
// matches. Content matches exclude pages already returned by title.
func (s *Search) VaultQuery(q string, contentLimit int) (model.VaultSearchResults, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return model.VaultSearchResults{
			TitleMatches:   []model.SearchHit{},
			ContentMatches: []model.SearchHit{},
		}, nil
	}
	if contentLimit <= 0 {
		contentLimit = 5
	}
	if contentLimit > 25 {
		contentLimit = 25
	}

	titleMatches, err := s.titleMatches(q)
	if err != nil {
		return model.VaultSearchResults{}, err
	}
	titlePaths := map[string]bool{}
	for _, hit := range titleMatches {
		titlePaths[hit.Path] = true
	}
	bodyMatches, err := s.bodyMatches(q, contentLimit, titlePaths)
	if err != nil {
		return model.VaultSearchResults{}, err
	}
	return model.VaultSearchResults{
		TitleMatches:   titleMatches,
		ContentMatches: bodyMatches,
	}, nil
}

func (s *Search) titleMatches(q string) ([]model.SearchHit, error) {
	rows, err := s.db.Query(`
		SELECT path, title
		FROM notes
		WHERE lower(title) LIKE ? ESCAPE '\'
		ORDER BY lower(title), path`, "%"+escapeLike(strings.ToLower(q))+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := []model.SearchHit{}
	for rows.Next() {
		var h model.SearchHit
		if err := rows.Scan(&h.Path, &h.Title); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

func (s *Search) bodyMatches(
	q string,
	limit int,
	exclude map[string]bool,
) ([]model.SearchHit, error) {
	match := ftsBodyQuery(q)
	if match == "" {
		return []model.SearchHit{}, nil
	}
	rows, err := s.db.Query(`
		SELECT path, title,
		       snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snip
		FROM notes_fts
		WHERE notes_fts MATCH ?
		ORDER BY rank
		LIMIT ?`, match, limit+len(exclude))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := []model.SearchHit{}
	for rows.Next() {
		var h model.SearchHit
		if err := rows.Scan(&h.Path, &h.Title, &h.Snippet); err != nil {
			return nil, err
		}
		if exclude[h.Path] {
			continue
		}
		hits = append(hits, h)
		if len(hits) >= limit {
			break
		}
	}
	return hits, rows.Err()
}

// Query returns FTS5 matches ranked by relevance, with a highlighted snippet.
func (s *Search) Query(q string, limit int) ([]model.SearchHit, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []model.SearchHit{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	// Make it a prefix match on the last token for as-you-type search.
	match := ftsQuery(q)
	if match == "" {
		return []model.SearchHit{}, nil
	}

	rows, err := s.db.Query(`
		SELECT path, title,
		       snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snip
		FROM notes_fts
		WHERE notes_fts MATCH ?
		ORDER BY rank
		LIMIT ?`, match, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	hits := []model.SearchHit{}
	for rows.Next() {
		var h model.SearchHit
		if err := rows.Scan(&h.Path, &h.Title, &h.Snippet); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

// Backlinks returns notes that link to the given path (by path or title stem).
func (s *Search) Backlinks(path string) ([]model.SearchHit, error) {
	stem := path
	if i := strings.LastIndex(stem, "/"); i >= 0 {
		stem = stem[i+1:]
	}
	stem = strings.TrimSuffix(stem, ".md")

	rows, err := s.db.Query(`
		SELECT DISTINCT n.path, n.title
		FROM links l
		JOIN notes n ON n.id = l.source_id
		WHERE l.target_path = ? OR l.target_path = ? OR l.target_path = ?
		ORDER BY n.title`, path, stem, stem+".md")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	hits := []model.SearchHit{}
	for rows.Next() {
		var h model.SearchHit
		if err := rows.Scan(&h.Path, &h.Title); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

// ftsQuery turns user input into a safe FTS5 query with a prefix on the last term.
func ftsQuery(q string) string {
	fields := strings.Fields(q)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		f = `"` + f + `"`
		if i == len(fields)-1 && f != "" {
			f += "*" // prefix match on final token
		}
		fields[i] = f
	}
	return strings.Join(fields, " ")
}

func ftsBodyQuery(q string) string {
	fields := strings.Fields(q)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		token := `"` + f + `"`
		if i == len(fields)-1 && token != "" {
			token += "*"
		}
		fields[i] = "body:" + token
	}
	return strings.Join(fields, " ")
}

func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}
