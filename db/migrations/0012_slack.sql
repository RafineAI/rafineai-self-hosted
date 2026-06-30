-- Migration 0012: slack
-- Followed Slack channels. Messages are fetched live from the Slack API on
-- demand (works without inbound webhooks, suited to on-prem deployments); this
-- table just records which channels the org chose to follow in the panel.

CREATE TABLE IF NOT EXISTS slack_channels (
    channel_id   TEXT        PRIMARY KEY,
    channel_name TEXT        NOT NULL DEFAULT '',
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
