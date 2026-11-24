# M2 implementation status

Implemented across the M2 foundation and the integrated wss hub. Agents are discovered, authenticated,
and exchange signed messages; offline messages wait durably in Postgres and survive a hub restart.

| Plan item | Implementation / verification |
| --- | --- |
| MM-201: directory | profiles, capability tags, private/friends/public visibility, 30s cache with invalidation; `test:hub` |
| MM-202: registrar | bootstrap-secret auth, one active session per agent, generation rotation, online/offline; `test:hub` |
| MM-203: offline mailbox | durable per-recipient queue, QUEUED/SENT/DELIVERED/EXPIRED, dedup, locking and reclaim; `test:hub` |
| MM-204: TLS/MAC/replay | wss with CA validation (no disable switch), per-pair HMAC signing with shared vectors, persistent nonce guard; `test`, `test:hub`, `demo:m2` |
| MM-205: integration | one wss hub composing registrar/directory/mailbox; `demo:m2` discovery, offline queue across hub restart, security negatives, M1 flow over wss |

The hub never holds pair keys and relays `auth` untouched; MAC gives integrity and origin authentication, not
confidentiality. `relay.persisted` is a hub control frame sent after the Postgres commit; `recipient.persisted`
stays an end-to-end agent ACK and only it marks a mailbox row DELIVERED.

## Verification scope

To reproduce the local scenarios, run `npm run demo:m2` after the [PostgreSQL, certificate, and demo-credential setup](../README.md#m2-demo-and-verification). The generated credentials and certificates are for development, not production key management. External network and device checks are tracked in the [network measurements](evidence/m4/README.md) and [mobile verification](evidence/m5/README.md).
