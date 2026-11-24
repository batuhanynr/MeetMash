# MeetMesh relay hub

The hub forwards agent messages and does not choose meeting times. The authenticated hub adds PostgreSQL-backed discovery, sessions, and an offline mailbox. See the [hub design decision](../../docs/decisions/002-m2-hub-persistence-and-security.md).

## Local protocol mode (M1)

From the repository root:

```sh
npm run hub
curl http://127.0.0.1:8787/health
```

This mode binds only to loopback. It validates and forwards messages but does not have a durable offline mailbox. Options: `--host`, `--port`, `--agents` (comma-separated), and `--run-id`. Use port `0` for an OS-assigned port. Command-line options override settings from the root `.env`.

## Authenticated mode (M2+)

Follow the [PostgreSQL and certificate setup](../../README.md#m2-demo-and-verification), then run `npm run hub:m2` from the root. The hub terminates TLS and routes messages; pairwise message authentication provides integrity, not end-to-end encryption. See the [M2 status record](../../docs/m2-status.md) for the verification scope.
