# MeetMesh

Flutter and Node.js monorepo for the CSE476 personal-agent project.
The implementation scope is defined in [the milestone plan](MeetMesh_Implementation_Plan_and_Issues.md).

```text
apps/hub          Local relay (Node.js + TypeScript)
apps/agent-node   Independent reference agent (Node.js + SQLite)
apps/mobile       Flutter application (Android + iOS)
packages/protocol Portable message schemas, fixtures, and validator
packages/runtime  Shared CLI validation and structured logging
scripts           Local orchestration and environment checks
tests             Protocol and real-network integration tests
docs/decisions    Architecture decisions
docs/evidence     Small reproducible validation records
```

Requirements: Node.js 26, npm 11, Flutter 3.38.7 / Dart 3.10.7.
Use the installed SDKs; do not upgrade them to run M1.

```sh
npm ci --offline --ignore-scripts
cd apps/mobile
flutter pub get --offline
cd ../..
npm run check
npm run build
npm run doctor
```

If a fresh machine has no package cache, omit `--offline` for the dependency restore.
See [runtime and routing](docs/decisions/001-runtime-and-routing.md) for SOLID boundaries and the relay adaptation.

## Local processes

```sh
cp .env.example .env
npm run local
```

This starts one hub and A/B/C as **four separate processes**, each agent with its own SQLite directory.
Check `http://127.0.0.1:8787/health` from another terminal. Ctrl+C / SIGTERM stops all four processes.
Port and identity collisions fail explicitly. To clear synthetic local data, stop the cluster and run:

```sh
npm run local:reset
```

Reset refuses to run while an agent holds its state lock. It clears inbox/outbox/work/effects/sequences, retaining identity ownership.
For manual control, start the hub and agents in separate terminals:

```sh
npm run hub
npm run agent -- --id agent-a
npm run agent -- --id agent-b
npm run agent -- --id agent-c
```

Each agent accepts JSON-line commands on stdin. See the [agent README](apps/agent-node/README.md).
Environment settings are loaded from the root `.env`; explicit arguments take precedence.
The local fixture always uses `agent-a`, `agent-b`, and `agent-c`.

## M1 demo and verification

```sh
npm run demo:m1
npm run test:gate:m1
npm run check:mobile
```

The demo is a **script-controlled protocol test**, using real loopback WebSocket connections and synthetic data.
It does not select a meeting time, call an LLM, or write a calendar. All six protocol message types cross the relay.
Every scenario uses clean isolated state, closes its processes, and removes its temporary SQLite files.

- `test:protocol`: portable schema/semantic vectors, without networking.
- `test:unit`: SQLite transactions, ownership, duplicate identity, ACK binding, expiry, and reset.
- `test:integration`: ten scenarios with real TCP connections and separate hub/agent processes.
- `test`: all Node tests.
- `test:gate:m1`: TypeScript check, JavaScript build, and all Node tests; exits nonzero on any failure.
- `test:regression`: the implemented M1 gate; later milestones extend it.

Gate results go to `.state/evidence/m1/`; demo results go to `.state/evidence/demo-m1/`.
Set `M1_EVIDENCE_DIR` to choose the gate destination. Reports contain the code commit, dirty-worktree flag,
runtime/dependency versions, synthetic test data, retry settings, outcome metrics, and sampled structured logs.
The [M1 status record](docs/m1-status.md) maps the plan to commands and remaining human checks.
CI runs the Node gate and Flutter analysis/widget test, and uploads the gate evidence on success or failure.

Default retries wait 1s, doubling up to 8s, with at most five retries. Gate scenarios explicitly shorten waits to 100/150ms.
No delivery is silently deleted after retry exhaustion. `DELIVERY_UNCONFIRMED` is visible and is never treated as meeting acceptance.

## M2 demo and verification

M2 adds discovery, authenticated sessions, a durable offline mailbox, and `wss://` with signed messages.
The hub uses Postgres; agents authenticate with a bootstrap secret and sign messages with a per-pair key.

One-time local setup:

```sh
npm run db:up            # Postgres on :5433 via docker-compose (or point DATABASE_URL at your own)
npm run certs            # dev TLS CA + hub cert into .state/certs
npm run secrets          # demo bootstrap secrets + pair keys into .state/secrets.json
```

Then run the demo and gate (both read DATABASE_URL, CERT_DIR, SECRETS_FILE from `.env`):

```sh
npm run demo:m2
npm run test:gate:m2
```

`demo:m2` prints a PASS/FAIL line per scenario: directory discovery, a message that stays queued for an
offline agent **and survives a hub restart** before it is redelivered, rejection of a forged session and a
tampered MAC, and the M1 REQUEST/PROPOSE/ACCEPT/CONFIRM flow over wss. To drive it by hand instead:

```sh
npm run hub:m2
npm run agent:m2 -- --id agent-a
npm run agent:m2 -- --id agent-b
npm run agent:m2 -- --id agent-c
```

Each agent reads JSON-line commands on stdin, including `{"command":"lookup","by":"name","term":"Carol"}`
and `{"command":"send","toAgentId":"agent-c","meetingId":"m","type":"REQUEST","payload":{...}}`.
Secrets and certificates live under `.state/` and are never committed. `test:hub` runs the Postgres-backed
unit and hub-core tests; `test:gate:m2` runs the typecheck, build, M1 regression, `test:hub`, and the M2 scenarios.
See the [M2 status record](docs/m2-status.md) and [ADR 002](docs/decisions/002-m2-hub-persistence-and-security.md).

## Current mobile environment

The Flutter shell was generated using the installed SDK. `flutter pub get --offline`, analysis, and the widget test run locally.
Android command-line tools are missing and Xcode cannot enumerate simulator runtimes on this machine.
Android/iOS binary builds are **not verified** by M1. See [the mobile README](apps/mobile/README.md); MM-501 remains open.
Directory discovery, durable hub mailboxes, authentication/MAC/TLS, scheduling, and mobile agent features remain in M2-M5.
