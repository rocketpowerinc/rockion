package main

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestGitHubWorkflowsAreValidAndActionsArePinned(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join(".github", "workflows", "*.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no GitHub Actions workflows found")
	}

	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var document yaml.Node
		if err := yaml.Unmarshal(data, &document); err != nil {
			t.Fatalf("%s is not valid YAML: %v", path, err)
		}
		for lineNumber, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if !strings.HasPrefix(trimmed, "uses:") {
				continue
			}
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "uses:"))
			value = strings.Fields(value)[0]
			at := strings.LastIndexByte(value, '@')
			if at < 0 || !isCommitSHA(value[at+1:]) {
				t.Errorf("%s:%d action must be pinned to a full commit SHA: %s", path, lineNumber+1, value)
			}
		}
	}
}

func isCommitSHA(value string) bool {
	if len(value) != 40 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
