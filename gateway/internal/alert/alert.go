// Package alert implements asynchronous, batched delivery of policy alerts to
// the database. Like the audit writer, it never blocks the hot path.
package alert

import (
	"context"
	"log/slog"
	"time"
)

// Entry mirrors store.AlertEntry to keep this package decoupled.
type Entry struct {
	UserID         string
	ConversationID string
	RuleName       string
	Category       string
	Action         string
	Severity       string
	Snippet        string
}

// FlushFunc persists a batch of alerts.
type FlushFunc func(ctx context.Context, batch []Entry) error

// Writer is an async batching alert sink.
type Writer struct {
	ch     chan Entry
	flush  FlushFunc
	period time.Duration
}

// New creates a Writer with a buffered channel.
func New(flush FlushFunc, period time.Duration) *Writer {
	if period <= 0 {
		period = 2 * time.Second
	}
	return &Writer{ch: make(chan Entry, 2048), flush: flush, period: period}
}

// Enqueue adds an alert without blocking; drops on overflow.
func (w *Writer) Enqueue(e Entry) {
	select {
	case w.ch <- e:
	default:
		slog.Warn("alert buffer full, dropping entry")
	}
}

// Run drains and flushes until ctx is cancelled, then flushes the remainder.
func (w *Writer) Run(ctx context.Context) {
	ticker := time.NewTicker(w.period)
	defer ticker.Stop()
	buf := make([]Entry, 0, 32)
	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := w.flush(context.Background(), buf); err != nil {
			slog.Error("alert flush failed", "err", err, "count", len(buf))
		}
		buf = buf[:0]
	}
	for {
		select {
		case <-ctx.Done():
			for {
				select {
				case e := <-w.ch:
					buf = append(buf, e)
				default:
					flush()
					return
				}
			}
		case e := <-w.ch:
			buf = append(buf, e)
			if len(buf) >= 32 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
