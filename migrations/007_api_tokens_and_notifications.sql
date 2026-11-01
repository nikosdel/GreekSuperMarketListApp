-- Refresh tokens and list notifications for the Express API.
-- The API hashes refresh tokens. It does not store the token itself.
CREATE TABLE refresh_token (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_token_user_idx ON refresh_token (user_id);

CREATE TABLE list_notification (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    list_id    BIGINT NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
    actor_id   BIGINT REFERENCES app_user (id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (
        kind IN ('item_added', 'item_updated', 'item_removed', 'list_saved', 'member_joined')
    ),
    message    TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at    TIMESTAMPTZ
);

CREATE INDEX list_notification_user_idx
    ON list_notification (user_id, created_at DESC);
