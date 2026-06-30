-- Migration 0014: rag
-- Vector store for "ask your documents". Requires the pgvector extension
-- (the postgres image is pgvector/pgvector:pg15). Embeddings are stored in an
-- unfixed-dimension vector column so different embedding models can coexist;
-- retrieval is exact cosine distance (fine for on-prem corpus sizes) and is
-- always scoped to a single embed_model so dimensions match.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    owner_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_index  INTEGER     NOT NULL DEFAULT 0,
    content      TEXT        NOT NULL,
    embed_model  TEXT        NOT NULL DEFAULT '',
    embedding    vector,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_owner ON document_chunks(owner_id);
