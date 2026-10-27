package conformance

import (
	"bytes"
	"go/format"
	"os"
	"path/filepath"
	"testing"
)

// The generator writes gofmt-formatted Go itself, because the golden test
// in packages/ts runs without a Go toolchain.
func TestGeneratedCodeIsGofmtFormatted(t *testing.T) {
	files, err := filepath.Glob("*/program.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("no generated programs: %v", err)
	}
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		formatted, err := format.Source(source)
		if err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if !bytes.Equal(source, formatted) {
			t.Errorf("%s is not gofmt-formatted", file)
		}
	}
}
