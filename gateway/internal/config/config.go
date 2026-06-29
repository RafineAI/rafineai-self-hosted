// Package config loads gateway settings from environment variables.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all runtime settings for the gateway.
type Config struct {
	Port             string
	DatabaseURL      string
	MasterKey        string
	SyncInterval     time.Duration
	AuditBatchSize   int
	AuditFlushPeriod time.Duration
	// Default per-user limits applied when a user has no override. 0 = unlimited.
	DefaultRPM         int
	DefaultDailyTokens int
}

// Load reads configuration from the environment, applying sensible defaults.
func Load() Config {
	return Config{
		Port:             getenv("GATEWAY_PORT", "8080"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		MasterKey:        getenv("RAFINE_MASTER_KEY", ""),
		SyncInterval:     time.Duration(getenvInt("GATEWAY_SYNC_INTERVAL_SEC", 10)) * time.Second,
		AuditBatchSize:   getenvInt("GATEWAY_AUDIT_BATCH_SIZE", 50),
		AuditFlushPeriod: time.Duration(getenvInt("GATEWAY_AUDIT_FLUSH_MS", 2000)) * time.Millisecond,
		DefaultRPM:         getenvInt("GATEWAY_DEFAULT_RPM", 0),
		DefaultDailyTokens: getenvInt("GATEWAY_DEFAULT_DAILY_TOKENS", 0),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
