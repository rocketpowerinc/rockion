package main

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestKeyedDebouncerKeepsIndependentPaths(t *testing.T) {
	debouncer := newKeyedDebouncer(10 * time.Millisecond)
	var first, second atomic.Int32
	debouncer.Do("a.md", func() { first.Add(1) })
	debouncer.Do("b.md", func() { second.Add(1) })
	debouncer.Do("a.md", func() { first.Add(1) })
	time.Sleep(40 * time.Millisecond)
	debouncer.Close()
	if first.Load() != 1 || second.Load() != 1 {
		t.Fatalf("events were dropped or duplicated: first=%d second=%d", first.Load(), second.Load())
	}
}

func TestKeyedDebouncerCloseCancelsPendingWork(t *testing.T) {
	debouncer := newKeyedDebouncer(time.Second)
	var called atomic.Bool
	debouncer.Do("note.md", func() { called.Store(true) })
	debouncer.Close()
	if called.Load() {
		t.Fatal("pending callback ran after close")
	}
}
