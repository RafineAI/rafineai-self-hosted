-- Per-user rate/quota limits. NULL means "use the gateway default"; the gateway
-- treats 0 as unlimited.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rate_limit_rpm    INTEGER,
    ADD COLUMN IF NOT EXISTS daily_token_quota INTEGER;
