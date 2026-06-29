// Command gateway is the RafineAI hot-path LLM proxy.
//
// It authenticates HMAC-signed API keys with zero DB round-trips, serves an
// OpenAI-compatible chat endpoint, applies a content policy, and records audit
// logs asynchronously. Provider config and the revocation blocklist are kept
// in RAM and refreshed by a background sync worker.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/audit"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/config"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/proxy"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()
	if cfg.MasterKey == "" {
		slog.Error("RAFINE_MASTER_KEY is required")
		os.Exit(1)
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st := state.New()

	// Connect to PostgreSQL (used off the hot path only).
	db, err := store.Open(rootCtx, cfg.DatabaseURL, cfg.MasterKey)
	if err != nil {
		slog.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	// Initial sync so we serve correct config from the first request.
	if snap, err := db.LoadSnapshot(rootCtx); err != nil {
		slog.Warn("initial state sync failed; starting empty", "err", err)
	} else {
		st.Replace(snap)
		slog.Info("initial state synced", "providers", len(snap.Providers))
	}

	// Background sync worker.
	go runSync(rootCtx, db, st, cfg.SyncInterval)

	// Async audit writer.
	auditWriter := audit.New(func(ctx context.Context, batch []audit.Entry) error {
		entries := make([]store.AuditEntry, len(batch))
		for i, e := range batch {
			entries[i] = store.AuditEntry(e)
		}
		return db.WriteAudit(ctx, entries)
	}, cfg.AuditBatchSize, cfg.AuditFlushPeriod)
	go auditWriter.Run(rootCtx)

	// HTTP server.
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Recover())

	h := proxy.New(cfg.MasterKey, st, auditWriter)
	e.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.POST("/v1/chat/completions", h.ChatCompletions)

	go func() {
		if err := e.Start(":" + cfg.Port); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			stop()
		}
	}()
	slog.Info("gateway listening", "port", cfg.Port)

	<-rootCtx.Done()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = e.Shutdown(shutdownCtx)
}

// runSync periodically refreshes the in-RAM snapshot from the database.
func runSync(ctx context.Context, db *store.Store, st *state.Store, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			snap, err := db.LoadSnapshot(ctx)
			if err != nil {
				slog.Warn("state sync failed; keeping previous snapshot", "err", err)
				continue
			}
			st.Replace(snap)
		}
	}
}
