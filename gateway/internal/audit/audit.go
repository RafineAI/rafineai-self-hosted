// Package audit implements asynchronous, batched audit logging.
//
// The hot path calls Enqueue (non-blocking). A background worker drains the
// channel, batching by size or time, and writes via the injected flush func.
// If the buffer is full, entries are dropped rather than blocking the request.
package audit

import (
	"context"
	"log/slog"
	"time"
)

// Entry mirrors store.AuditEntry but keeps this package decoupled.
type Entry struct {
	UserID          string
	ProviderID      string
	ConversationID  string
	Model           string
	RequestTokens   int
	ResponseTokens  int
	LatencyMS       int
	StatusCode      int
	AppliedPolicies string
	Error           string
}

// FlushFunc persists a batch of entries.
type FlushFunc func(ctx context.Context, batch []Entry) error

// Writer is an async batching audit logger.
type Writer struct {
	ch        chan Entry
	flush     FlushFunc
	batchSize int
	period    time.Duration
}

// New creates a Writer with a buffered channel.
func New(flush FlushFunc, batchSize int, period time.Duration) *Writer {
	if batchSize <= 0 {
		batchSize = 50
	}
	if period <= 0 {
		period = 2 * time.Second
	}
	return &Writer{
		ch:        make(chan Entry, 4096),
		flush:     flush,
		batchSize: batchSize,
		period:    period,
	}
}

// Enqueue adds an entry without blocking the caller. Drops on overflow.
func (w *Writer) Enqueue(e Entry) {
	select {
	case w.ch <- e:
	default:
		slog.Warn("audit buffer full, dropping entry")
	}
}

// Run drains and flushes until ctx is cancelled, then flushes the remainder.
func (w *Writer) Run(ctx context.Context) {
	ticker := time.NewTicker(w.period)
	defer ticker.Stop()

	buf := make([]Entry, 0, w.batchSize)
	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := w.flush(context.Background(), buf); err != nil {
			slog.Error("audit flush failed", "err", err, "count", len(buf))
		}
		buf = buf[:0]
	}

	for {
		select {
		case <-ctx.Done():
			// Drain whatever is buffered in the channel, then flush.
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
			if len(buf) >= w.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
