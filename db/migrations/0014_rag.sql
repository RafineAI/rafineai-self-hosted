-- Migration 0014: rag
-- Vector store for "ask your documents". Prefers the pgvector extension (the
-- bundled postgres image is pgvector/pgvector:pg15). If pgvector is NOT
-- available on the running server, this migration degrades gracefully: it logs
-- a notice and skips the vector table so the rest of the app still boots
-- (RAG features are simply unavailable until pgvector is installed).
--
-- Embeddings use an unfixed-dimension vector column so different embedding
-- models can coexist; retrieval is exact cosine distance (fine for on-prem
-- corpus sizes) and is always scoped to one embed_model so dimensions match.

DO $$
BEGIN
    -- Try to enable pgvector; bail out of the whole migration body if missing.
    BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pgvector not available; skipping RAG tables (RAG disabled)';
        RETURN;
    END;

    -- Dynamic SQL so the `vector` type is only resolved when the extension
    -- exists (avoids parse-time errors on servers without pgvector).
    EXECUTE $ddl$
        CREATE TABLE IF NOT EXISTS document_chunks (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id  UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            owner_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chunk_index  INTEGER     NOT NULL DEFAULT 0,
            content      TEXT        NOT NULL,
            embed_model  TEXT        NOT NULL DEFAULT '',
            embedding    vector,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    $ddl$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chunks_owner ON document_chunks(owner_id)';
END $$;
