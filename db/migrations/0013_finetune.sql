-- Migration 0013: finetune
-- Fine-tuning jobs proxied to the provider (OpenAI). The training data comes
-- from a stored document; we keep the external job id and last-known status.

CREATE TABLE IF NOT EXISTS finetune_jobs (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type        TEXT        NOT NULL DEFAULT 'openai',
    base_model           TEXT        NOT NULL,
    training_document_id UUID        REFERENCES documents(id) ON DELETE SET NULL,
    external_file_id     TEXT        NOT NULL DEFAULT '',
    external_job_id      TEXT        NOT NULL DEFAULT '',
    status               TEXT        NOT NULL DEFAULT 'pending',
    fine_tuned_model     TEXT        NOT NULL DEFAULT '',
    error                TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finetune_owner ON finetune_jobs(owner_id, created_at DESC);
