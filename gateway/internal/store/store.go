// Package store is the gateway's PostgreSQL access layer.
//
// It is used off the hot path only: the sync worker reads config into a
// Snapshot, and the audit worker batch-writes logs. Per-request auth and
// routing never touch this package.
package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rafineai/rafineai-self-hosted/gateway/internal/policy"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/secretbox"
	"github.com/rafineai/rafineai-self-hosted/gateway/internal/state"
)

// Store wraps a pgx connection pool.
type Store struct {
	pool      *pgxpool.Pool
	masterKey string
}

// Open connects to PostgreSQL with a short retry loop (the DB may still be
// starting up under docker compose).
func Open(ctx context.Context, dsn, masterKey string) (*Store, error) {
	var pool *pgxpool.Pool
	var err error
	for attempt := 0; attempt < 10; attempt++ {
		pool, err = pgxpool.New(ctx, dsn)
		if err == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				return &Store{pool: pool, masterKey: masterKey}, nil
			} else {
				err = pingErr
				pool.Close()
			}
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
	return nil, err
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// LoadSnapshot builds a fresh in-RAM view from the database, decrypting
// provider credentials and OAuth tokens with the master key.
func (s *Store) LoadSnapshot(ctx context.Context) (*state.Snapshot, error) {
	snap := &state.Snapshot{
		Providers:  map[string]state.Provider{},
		UserTokens: map[string]string{},
		Blocked:    map[string]struct{}{},
		UserLimits: map[string]state.UserLimit{},
	}

	// Providers.
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, type, auth_mode, api_key_encrypted, base_url, default_model, is_active,
		       light_model, heavy_model, route_threshold_tokens
		FROM llm_providers`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var (
			id, name, ptype, authMode, model string
			encKey, baseURL                  *string
			lightModel, heavyModel           *string
			routeThreshold                   int
			active                           bool
		)
		if err := rows.Scan(&id, &name, &ptype, &authMode, &encKey, &baseURL, &model, &active,
			&lightModel, &heavyModel, &routeThreshold); err != nil {
			rows.Close()
			return nil, err
		}
		p := state.Provider{
			ID: id, Name: name, Type: ptype, AuthMode: authMode,
			DefaultModel: model, Active: active, RouteThreshold: routeThreshold,
		}
		if baseURL != nil {
			p.BaseURL = *baseURL
		}
		if lightModel != nil {
			p.LightModel = *lightModel
		}
		if heavyModel != nil {
			p.HeavyModel = *heavyModel
		}
		if encKey != nil && *encKey != "" {
			if dec, derr := secretbox.Decrypt(s.masterKey, *encKey); derr == nil {
				p.APIKey = dec
			}
		}
		snap.Providers[id] = p
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Per-user OAuth tokens.
	trows, err := s.pool.Query(ctx, `
		SELECT user_id, provider_id, access_token_encrypted FROM user_provider_tokens`)
	if err != nil {
		return nil, err
	}
	for trows.Next() {
		var userID, providerID, encTok string
		if err := trows.Scan(&userID, &providerID, &encTok); err != nil {
			trows.Close()
			return nil, err
		}
		if dec, derr := secretbox.Decrypt(s.masterKey, encTok); derr == nil {
			snap.UserTokens[userID+":"+providerID] = dec
		}
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return nil, err
	}

	// Per-user rate/quota overrides (only rows that set at least one limit).
	lrows, err := s.pool.Query(ctx, `
		SELECT id::text, rate_limit_rpm, daily_token_quota
		FROM users
		WHERE rate_limit_rpm IS NOT NULL OR daily_token_quota IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	for lrows.Next() {
		var uid string
		var rpm, daily *int
		if err := lrows.Scan(&uid, &rpm, &daily); err != nil {
			lrows.Close()
			return nil, err
		}
		ul := state.UserLimit{RPM: -1, DailyTokens: -1}
		if rpm != nil {
			ul.RPM = *rpm
		}
		if daily != nil {
			ul.DailyTokens = *daily
		}
		snap.UserLimits[uid] = ul
	}
	lrows.Close()
	if err := lrows.Err(); err != nil {
		return nil, err
	}

	// Admin-defined custom policy rules (compiled).
	prows, err := s.pool.Query(ctx, `
		SELECT name, category, kind, pattern, action, severity
		FROM policy_rules WHERE enabled = TRUE`)
	if err != nil {
		return nil, err
	}
	for prows.Next() {
		var name, category, kind, pattern, action, severity string
		if err := prows.Scan(&name, &category, &kind, &pattern, &action, &severity); err != nil {
			prows.Close()
			return nil, err
		}
		var rule *policy.Rule
		if kind == "keyword" {
			rule = policy.NewKeywordRule(name, category, action, severity, pattern)
		} else {
			rule = policy.NewRegexRule(name, category, action, severity, pattern)
		}
		if rule != nil {
			snap.Rules = append(snap.Rules, rule)
		}
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return nil, err
	}

	// Revocation blocklist.
	brows, err := s.pool.Query(ctx, `SELECT kid FROM gateway_keys WHERE revoked = TRUE`)
	if err != nil {
		return nil, err
	}
	for brows.Next() {
		var kid string
		if err := brows.Scan(&kid); err != nil {
			brows.Close()
			return nil, err
		}
		snap.Blocked[kid] = struct{}{}
	}
	brows.Close()
	return snap, brows.Err()
}

// AuditEntry is one row to be written to audit_logs.
type AuditEntry struct {
	UserID         string
	ProviderID     string
	ConversationID string
	Model          string
	RequestTokens  int
	ResponseTokens int
	LatencyMS      int
	StatusCode     int
	AppliedPolicies string // JSON array
	Error          string
}

// WriteAudit batch-inserts audit entries in a single network round-trip
// using a pgx batch.
func (s *Store) WriteAudit(ctx context.Context, entries []AuditEntry) error {
	if len(entries) == 0 {
		return nil
	}
	const q = `
		INSERT INTO audit_logs
			(user_id, provider_id, conversation_id, model,
			 request_tokens, response_tokens, latency_ms, status_code,
			 applied_policies, error)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`

	batch := &pgx.Batch{}
	for _, e := range entries {
		batch.Queue(q,
			nullable(e.UserID), nullable(e.ProviderID), nullable(e.ConversationID),
			nullable(e.Model), e.RequestTokens, e.ResponseTokens, e.LatencyMS,
			e.StatusCode, policiesOrEmpty(e.AppliedPolicies), nullable(e.Error),
		)
	}
	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()
	for range entries {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

// AlertEntry is one row to be written to alerts.
type AlertEntry struct {
	UserID         string
	ConversationID string
	RuleName       string
	Category       string
	Action         string
	Severity       string
	Snippet        string
}

// WriteAlerts batch-inserts policy alerts in a single round-trip.
func (s *Store) WriteAlerts(ctx context.Context, entries []AlertEntry) error {
	if len(entries) == 0 {
		return nil
	}
	const q = `
		INSERT INTO alerts
			(user_id, conversation_id, rule_name, category, action, severity, snippet)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	batch := &pgx.Batch{}
	for _, e := range entries {
		batch.Queue(q, nullable(e.UserID), nullable(e.ConversationID),
			e.RuleName, e.Category, e.Action, e.Severity, e.Snippet)
	}
	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()
	for range entries {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func policiesOrEmpty(s string) string {
	if s == "" {
		return "[]"
	}
	return s
}
