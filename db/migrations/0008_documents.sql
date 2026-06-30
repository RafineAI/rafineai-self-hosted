-- Migration 0008: documents
-- Internal file storage. Files live on a storage volume; this table holds
-- metadata + the storage key. Documents are owned by a user and optionally
-- shared with a team. message_attachments links a stored document to a chat
-- message so users can send files into a conversation.

CREATE TABLE IF NOT EXISTS documents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id      UUID,                        -- optional team share (FK added in 0009)
    filename     TEXT        NOT NULL,
    mime_type    TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT      NOT NULL DEFAULT 0,
    sha256       TEXT        NOT NULL DEFAULT '',
    storage_key  TEXT        NOT NULL,        -- path/key within the storage backend
    indexed      BOOLEAN     NOT NULL DEFAULT FALSE,  -- RAG: chunked+embedded yet?
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
