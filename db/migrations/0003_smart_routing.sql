-- Smart routing: when both light_model and heavy_model are set on a provider,
-- the gateway estimates the prompt size and routes to the cheaper (light) model
-- below the threshold, or the heavier model at/above it.
ALTER TABLE llm_providers
    ADD COLUMN IF NOT EXISTS light_model            TEXT,
    ADD COLUMN IF NOT EXISTS heavy_model            TEXT,
    ADD COLUMN IF NOT EXISTS route_threshold_tokens INTEGER NOT NULL DEFAULT 2000;
