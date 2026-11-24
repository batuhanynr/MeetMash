# M1 implementation status

This historical record covers the runnable monorepo and protocol demonstrated in M1.

| Plan item | Implementation / verification |
| --- | --- |
| MM-101: runnable monorepo | npm/Flutter init; `npm run local`, `/health`, independent SQLite owners, collision tests, controlled stop/reset, ADR 001 |
| MM-102: portable contract | JSON Schema, public errors, valid/invalid vectors for every type, phase/scope variants; `npm run test:protocol` |
| MM-103: three-agent relay | loopback WebSocket adapters, fixed allowlist, bound sender identity, separate processes; M1-T1/T2/T4/100 |
| MM-104: durability | atomic inbox+work, synthetic effect+completion, outbox and sequences, retry/duplicate/conflict/expiry states; M1-T3/T5/DUPLICATE/UNCONFIRMED/OUTBOX |
| MM-105: demo and gate | `demo:m1`, `test:gate:m1`, structured logs, actual-network test group, CI and evidence reports |

The gate includes all five required scenarios, 100 unique deliveries with 100 effects, ten copies with one effect,
conflicting message ID rejection, sender and receiver SIGKILL recovery, independent group ACKs, and collision errors.

The M1 effect is a synthetic durable row. It demonstrates delivery idempotency, not a negotiated meeting or a calendar write.
The hub is a relay adaptation of the proposal, not a direct P2P registrar. See [ADR 001](decisions/001-runtime-and-routing.md).

## Verification scope

The [recorded M1 evidence](evidence/m1/README.md) covers the local protocol scenarios. It does not claim a second member's independent run or verification of Android/iOS binaries or the external Air lab. See the [current mobile and mixed-agent evidence](evidence/m5/README.md) for later checks.
