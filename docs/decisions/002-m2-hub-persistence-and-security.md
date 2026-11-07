# 002: M2 hub persistence and transport security

Status: accepted for M2.

## Hub persistence

- The hub keeps the Directory, Registrar sessions, and the durable offline mailbox in PostgreSQL.
- `infra/local/docker-compose.yml` runs Postgres 16 on host port 5433 so it does not collide with a developer's existing 5432 instance.
- The hub reads `DATABASE_URL`. The schema in `infra/local/schema.sql` is applied idempotently on startup; every table uses `CREATE TABLE IF NOT EXISTS`.
- Reference agents keep their own SQLite inbox/outbox (unchanged from M1). Postgres is the hub's store only.
- Redis is not used; the plan marks it optional for the first version.

## Transport security

- M2 upgrades the relay from loopback `ws://` to `wss://` with certificate validation. No "disable verification" switch exists.
- `scripts/dev-certs.ts` generates a local development CA and a hub certificate into `.state/certs/` (gitignored). Agents trust that CA explicitly; they do not trust the system store for the demo and never skip verification.
- Message integrity between agents uses an HMAC carried in the envelope `auth` field over a canonical byte string. Keys are per agent pair, loaded from a gitignored local secrets file, never committed and never stored in the hub DB. The hub relays `auth` untouched and does not hold pair keys.
- TLS protects the connection; it is not presented as end-to-end content encryption through the relay. The HMAC gives integrity and origin authentication, not confidentiality.
- Replay protection is persistent nonce/hash history on the recipient agent, kept for the accepted message lifetime, so a restart cannot re-run an old accepted message.

## Boundaries

- Directory: discovery and visibility only. It never routes messages or stores calendar data.
- Registrar: binds a stable agentId to one active authenticated session; it issues and rotates sessions but does not interpret domain payloads.
- Mailbox: per-recipient durable queue with explicit delivery states; it owns `relay.persisted` ACKs after a DB commit, never `recipient.persisted`.
- Secrets (bootstrap credentials, pair keys, dev certs) live outside the repo. This demo key distribution is not a production key-management system.
