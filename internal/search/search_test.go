package search

import "testing"

func TestFTSQueryQuotesUserInput(t *testing.T) {
	tests := map[string]string{
		"hello world": `"hello" "world"*`,
		`a"b`:         `"a""b"*`,
		"OR delete":   `"OR" "delete"*`,
		"foo-bar":     `"foo-bar"*`,
	}
	for input, want := range tests {
		if got := ftsQuery(input); got != want {
			t.Fatalf("ftsQuery(%q) = %q, want %q", input, got, want)
		}
	}
}
