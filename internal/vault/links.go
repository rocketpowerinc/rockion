package vault

import (
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	markdownLinkPattern = regexp.MustCompile(`(\!?\[[^\]]*\]\()([^)]+)(\))`)
	wikilinkPattern     = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
)

// RewriteLinksAfterRename preserves internal link targets when a note or folder
// moves. It also recalculates every relative link inside moved notes because the
// source directory changed.
func (v *Vault) RewriteLinksAfterRename(
	oldRel, newRel string,
	isDir bool,
	originalSources []string,
) ([]string, error) {
	oldRel = filepath.ToSlash(filepath.Clean(oldRel))
	newRel = filepath.ToSlash(filepath.Clean(newRel))
	rewritten := []string{}
	for _, originalSource := range originalSources {
		originalSource = filepath.ToSlash(filepath.Clean(originalSource))
		currentSource, sourceMoved := mapRenamedPath(originalSource, oldRel, newRel, isDir)
		if !sourceMoved {
			currentSource = originalSource
		}
		note, err := v.Read(currentSource)
		if err != nil {
			return rewritten, err
		}
		updated := rewriteMarkdownLinks(
			note.Markdown,
			originalSource,
			currentSource,
			oldRel,
			newRel,
			isDir,
			sourceMoved,
		)
		updated = rewriteWikilinks(updated, oldRel, newRel, isDir)
		if updated != note.Markdown {
			if err := v.WriteExpected(currentSource, updated, note.Version); err != nil {
				return rewritten, err
			}
			rewritten = append(rewritten, currentSource)
		}
	}
	return rewritten, nil
}

func rewriteMarkdownLinks(
	body, originalSource, currentSource, oldRel, newRel string,
	isDir, sourceMoved bool,
) string {
	return markdownLinkPattern.ReplaceAllStringFunc(body, func(match string) string {
		parts := markdownLinkPattern.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		destination, suffix := splitMarkdownDestination(parts[2])
		angleWrapped := strings.HasPrefix(destination, "<") && strings.HasSuffix(destination, ">")
		if angleWrapped {
			destination = strings.TrimSuffix(strings.TrimPrefix(destination, "<"), ">")
		}
		parsed, err := url.Parse(destination)
		if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" ||
			strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(destination, "#") {
			return match
		}
		decodedPath, err := url.PathUnescape(parsed.Path)
		if err != nil {
			return match
		}
		resolved := cleanSlashPath(filepath.Join(filepath.Dir(filepath.FromSlash(originalSource)), filepath.FromSlash(decodedPath)))
		mapped, targetMoved := mapRenamedPath(resolved, oldRel, newRel, isDir)
		if !targetMoved {
			mapped = resolved
		}
		if !sourceMoved && !targetMoved {
			return match
		}
		relative, err := filepath.Rel(
			filepath.Dir(filepath.FromSlash(currentSource)),
			filepath.FromSlash(mapped),
		)
		if err != nil {
			return match
		}
		relative = filepath.ToSlash(relative)
		if relative == "." {
			relative = filepath.Base(filepath.FromSlash(mapped))
		}
		relative = strings.ReplaceAll(relative, " ", "%20")
		parsed.Path = relative
		parsed.RawPath = ""
		rewritten := parsed.String()
		if angleWrapped {
			rewritten = "<" + rewritten + ">"
		}
		return parts[1] + rewritten + suffix + parts[3]
	})
}

func splitMarkdownDestination(raw string) (string, string) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "<") {
		if end := strings.Index(raw, ">"); end >= 0 {
			return raw[:end+1], raw[end+1:]
		}
	}
	if i := strings.IndexAny(raw, " \t"); i >= 0 {
		return raw[:i], raw[i:]
	}
	return raw, ""
}

func rewriteWikilinks(body, oldRel, newRel string, isDir bool) string {
	oldStem := strings.TrimSuffix(oldRel, filepath.Ext(oldRel))
	newStem := strings.TrimSuffix(newRel, filepath.Ext(newRel))
	oldBase := filepath.Base(filepath.FromSlash(oldRel))
	newBase := filepath.Base(filepath.FromSlash(newRel))
	oldBaseStem := strings.TrimSuffix(oldBase, filepath.Ext(oldBase))
	newBaseStem := strings.TrimSuffix(newBase, filepath.Ext(newBase))

	return wikilinkPattern.ReplaceAllStringFunc(body, func(match string) string {
		parts := wikilinkPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		targetAndAlias := strings.SplitN(parts[1], "|", 2)
		target := strings.TrimSpace(targetAndAlias[0])
		replacement := ""
		switch target {
		case oldRel:
			replacement = newRel
		case oldStem:
			replacement = newStem
		case oldBase:
			replacement = newBase
		case oldBaseStem:
			replacement = newBaseStem
		default:
			if isDir && strings.HasPrefix(target, oldRel+"/") {
				replacement = newRel + strings.TrimPrefix(target, oldRel)
			} else if isDir && strings.HasPrefix(target, oldStem+"/") {
				replacement = newStem + strings.TrimPrefix(target, oldStem)
			}
		}
		if replacement == "" {
			return match
		}
		if len(targetAndAlias) == 2 {
			replacement += "|" + targetAndAlias[1]
		}
		return "[[" + replacement + "]]"
	})
}

func cleanSlashPath(value string) string {
	return filepath.ToSlash(filepath.Clean(value))
}
