package effect

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
)

// events records what happened, in order, from any fiber.
type events struct {
	mu      sync.Mutex
	entries []string
}

func (e *events) add(entry string) Effect[Unit] {
	return Sync(func() Unit {
		e.record(entry)
		return Unit{}
	})
}

func (e *events) record(entry string) {
	e.mu.Lock()
	e.entries = append(e.entries, entry)
	e.mu.Unlock()
}

func (e *events) list() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.entries...)
}

func (e *events) expect(t *testing.T, want ...string) {
	t.Helper()
	if got := e.list(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %q, want %q", got, want)
	}
}

func run[A any](e Effect[A]) Exit[A] { return RunExit(context.Background(), e) }

func mustSucceed[A any](t *testing.T, e Effect[A]) A {
	t.Helper()
	exit := run(e)
	value, ok := exit.Value()
	if !ok {
		t.Fatalf("expected success, got %v", exit)
	}
	return value
}

func mustFailWith[A any](t *testing.T, e Effect[A]) error {
	t.Helper()
	exit := run(e)
	err, ok := exit.Cause().Failure()
	if !ok {
		t.Fatalf("expected a typed failure, got %v", exit)
	}
	return err
}

type testError struct{ name string }

func (e testError) Error() string { return e.name }
func (testError) Tag() string     { return "testError" }

type otherError struct{}

func (otherError) Error() string { return "other" }

var errBoom = errors.New("boom")
