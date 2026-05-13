-- B Visible — Postgres init script.
--
-- Runs once on a fresh data volume only. Postgres ignores everything in
-- docker-entrypoint-initdb.d once $PGDATA is non-empty, so this file is
-- safe to leave in place across container restarts and recreations.
--
-- pgcrypto: provides gen_random_uuid() and crypt(). User passwords are
-- hashed with Argon2id in app code, NOT here, but pgcrypto is so commonly
-- needed for incidental functions that enabling it on day one is the
-- right default.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
