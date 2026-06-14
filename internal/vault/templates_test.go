package vault

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestPageTemplatesSeedOnceAndTrackDirectoryChanges(t *testing.T) {
	v := openTestVault(t)
	seedEntries, err := defaultPageTemplates.ReadDir("default_templates")
	if err != nil {
		t.Fatal(err)
	}
	want := make([]string, 0, len(seedEntries))
	for _, entry := range seedEntries {
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			want = append(want, entry.Name())
		}
	}
	sort.SliceStable(want, func(i, j int) bool {
		return strings.ToLower(want[i]) < strings.ToLower(want[j])
	})
	if len(want) == 0 {
		t.Fatal("no embedded default page templates")
	}

	templates, err := v.PageTemplates()
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(templates))
	for _, template := range templates {
		got = append(got, template.ID)
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("templates = %v, want %v", got, want)
	}

	dir := filepath.Join(v.Root, ".rockion", "templates")
	deleted := want[len(want)-1]
	if err := os.Remove(filepath.Join(dir, deleted)); err != nil {
		t.Fatal(err)
	}
	custom := "Custom Runtime Template.md"
	if err := os.WriteFile(
		filepath.Join(dir, custom),
		[]byte("# {{title}}\n\n## This week\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	templates, err = v.PageTemplates()
	if err != nil {
		t.Fatal(err)
	}
	got = got[:0]
	for _, template := range templates {
		got = append(got, template.ID)
	}
	updatedWant := append([]string(nil), want[:len(want)-1]...)
	updatedWant = append(updatedWant, custom)
	sort.SliceStable(updatedWant, func(i, j int) bool {
		return strings.ToLower(updatedWant[i]) < strings.ToLower(updatedWant[j])
	})
	if strings.Join(got, "|") != strings.Join(updatedWant, "|") {
		t.Fatalf("updated templates = %v, want %v", got, updatedWant)
	}
	if _, err := os.Stat(filepath.Join(dir, deleted)); !os.IsNotExist(err) {
		t.Fatal("deleted default template was unexpectedly re-created")
	}
}

func TestCreateManagedPageFromVaultTemplate(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsurePageTemplates(); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(v.Root, ".rockion", "templates", "Client Brief.md")
	template := "---\nstatus: Draft\ntitle: Old title\n---\n" +
		"# Template heading\n\nClient: {{ title }}\n"
	if err := os.WriteFile(templatePath, []byte(template), 0o644); err != nil {
		t.Fatal(err)
	}

	page, err := v.CreateManagedPageFromTemplate(
		"Project/dashboard.md",
		"Plan $100",
		"Client Brief.md",
	)
	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Plan $100" {
		t.Fatalf("page title = %q", page.Title)
	}
	if page.Path != "Project/Client Brief/Plan $100.md" {
		t.Fatalf("page path = %q", page.Path)
	}
	if page.Markdown != "# Plan $100\n\nClient: Plan $100\n" {
		t.Fatalf("page markdown = %q", page.Markdown)
	}
	if page.PageID == "" || page.Frontmatter["status"] != "Draft" {
		t.Fatalf("page frontmatter = %#v", page.Frontmatter)
	}
	if page.Frontmatter["title"] != "Plan $100" {
		t.Fatalf("frontmatter title = %#v", page.Frontmatter["title"])
	}
	if page.Frontmatter[templateTagKey] != "Client Brief" {
		t.Fatalf("template tag = %#v", page.Frontmatter[templateTagKey])
	}
	source, err := os.ReadFile(templatePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(source) != template {
		t.Fatal("creating a page modified its source template")
	}
}

func TestTemplateTagsAndColors(t *testing.T) {
	tests := []struct {
		template string
		tag      string
		color    string
	}{
		{template: "", tag: "Other", color: "gray"},
		{template: "Blank.md", tag: "Other", color: "gray"},
		{template: "Bootstrap.md", tag: "Bootstrap", color: "green"},
		{template: "Cheatsheet.md", tag: "Cheatsheet", color: "pink"},
		{template: "Cheat Sheet.md", tag: "Cheatsheet", color: "pink"},
		{template: "CheatSheets.md", tag: "Cheatsheet", color: "pink"},
		{template: "Cheetsheet.md", tag: "Cheatsheet", color: "pink"},
	}
	for _, test := range tests {
		tag := templateTag(test.template)
		if tag != test.tag {
			t.Errorf("templateTag(%q) = %q, want %q", test.template, tag, test.tag)
		}
		if color := templateTagColor(tag); color != test.color {
			t.Errorf("templateTagColor(%q) = %q, want %q", tag, color, test.color)
		}
	}
	customColor := templateTagColor("Client Brief")
	if customColor == "gray" || customColor == "" {
		t.Fatalf("custom template color = %q", customColor)
	}
	if customColor != templateTagColor("Client Brief") {
		t.Fatal("custom template color is not deterministic")
	}
}

func TestTemplateTagFolders(t *testing.T) {
	tests := []struct {
		tag  string
		want string
	}{
		{tag: "Other", want: "Other"},
		{tag: "Bootstrap", want: "Bootstraps"},
		{tag: "Bootstraps", want: "Bootstraps"},
		{tag: "Cheatsheet", want: "Cheatsheets"},
		{tag: "Cheat Sheet", want: "Cheatsheets"},
		{tag: "Client Brief", want: "Client Brief"},
	}
	for _, test := range tests {
		got, err := templateTagFolder(test.tag)
		if err != nil {
			t.Fatalf("templateTagFolder(%q): %v", test.tag, err)
		}
		if got != test.want {
			t.Errorf("templateTagFolder(%q) = %q, want %q", test.tag, got, test.want)
		}
	}
}

func TestPageTemplateRejectsUnsafeNamesAndReservedMetadata(t *testing.T) {
	v := openTestVault(t)
	if _, err := v.CreateProject("Project"); err != nil {
		t.Fatal(err)
	}
	if err := v.EnsurePageTemplates(); err != nil {
		t.Fatal(err)
	}
	if _, err := v.CreateManagedPageFromTemplate(
		"Project/dashboard.md",
		"Unsafe",
		"../Blank.md",
	); err == nil {
		t.Fatal("template path traversal was accepted")
	}

	templatePath := filepath.Join(v.Root, ".rockion", "templates", "Reserved.md")
	if err := os.WriteFile(
		templatePath,
		[]byte("---\nrockion_id: attacker-controlled\n---\n# {{title}}\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := v.CreateManagedPageFromTemplate(
		"Project/dashboard.md",
		"Unsafe",
		"Reserved.md",
	); err == nil || !strings.Contains(err.Error(), "reserved property") {
		t.Fatalf("reserved metadata error = %v", err)
	}

	if err := os.WriteFile(
		templatePath,
		[]byte("---\nrockion_template_tag: Fake\n---\n# {{title}}\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := v.CreateManagedPageFromTemplate(
		"Project/dashboard.md",
		"Unsafe tag",
		"Reserved.md",
	); err == nil || !strings.Contains(err.Error(), "reserved property") {
		t.Fatalf("reserved template tag error = %v", err)
	}
}
