package audit

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestFlushBySize(t *testing.T) {
	var mu sync.Mutex
	var got []Entry
	w := New(func(_ context.Context, batch []Entry) error {
		mu.Lock()
		got = append(got, batch...)
		mu.Unlock()
		return nil
	}, 3, time.Hour) // long period so only size triggers

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()

	for i := 0; i < 3; i++ {
		w.Enqueue(Entry{Model: "m"})
	}
	// Give the worker a moment to flush the full batch.
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	n := len(got)
	mu.Unlock()
	if n != 3 {
		t.Fatalf("expected 3 flushed by size, got %d", n)
	}
	cancel()
	<-done
}

func TestFlushOnShutdownDrains(t *testing.T) {
	var mu sync.Mutex
	var got []Entry
	w := New(func(_ context.Context, batch []Entry) error {
		mu.Lock()
		got = append(got, batch...)
		mu.Unlock()
		return nil
	}, 100, time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()

	w.Enqueue(Entry{Model: "a"})
	w.Enqueue(Entry{Model: "b"})
	cancel() // should drain + flush remaining 2
	<-done

	mu.Lock()
	n := len(got)
	mu.Unlock()
	if n != 2 {
		t.Fatalf("expected 2 drained on shutdown, got %d", n)
	}
}

func TestEnqueueNeverBlocks(t *testing.T) {
	w := New(func(_ context.Context, _ []Entry) error { return nil }, 10, time.Hour)
	// No Run loop: channel fills then overflows. Must not block.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10000; i++ {
			w.Enqueue(Entry{})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Enqueue blocked on full buffer")
	}
}
