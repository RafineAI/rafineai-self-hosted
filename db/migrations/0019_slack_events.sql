-- Migration 0019: slack inbound events dedup
-- The Slack Events API retries a delivery until it receives a 200 within 3s.
-- We acknowledge immediately and generate the auto-reply asynchronously, so we
-- record handled event ids here to keep mention handling idempotent across
-- Slack's retries (never reply twice to the same mention).

CREATE TABLE IF NOT EXISTS slack_events_seen (
    event_id   TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slack_events_seen_created ON slack_events_seen(created_at);
