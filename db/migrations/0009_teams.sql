-- Migration 0009: teams
-- Teams group users and carry their own LLM usage limits and provider
-- permissions. Effective per-request limits: a user's personal override wins;
-- otherwise the most restrictive limit among their teams applies; otherwise the
-- gateway default. Provider access: if any team_provider_access row exists for a
-- provider, it is "restricted" and only members of a granting team (or admins)
-- may use it; with no rows it is unrestricted.

CREATE TABLE IF NOT EXISTS teams (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT        NOT NULL UNIQUE,
    description       TEXT        NOT NULL DEFAULT '',
    rate_limit_rpm    INTEGER,                 -- null = inherit; 0 = unlimited
    daily_token_quota INTEGER,                 -- null = inherit; 0 = unlimited
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_team TEXT NOT NULL DEFAULT 'member' CHECK (role_in_team IN ('member', 'lead')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS team_provider_access (
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, provider_id)
);

-- Now that teams exists, wire the documents.team_id FK added loosely in 0008.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'documents_team_id_fkey'
    ) THEN
        ALTER TABLE documents
            ADD CONSTRAINT documents_team_id_fkey
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    END IF;
END $$;
