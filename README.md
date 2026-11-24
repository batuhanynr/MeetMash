# MeetMesh

MeetMesh is a CSE476 project in which personal agents negotiate a common meeting time through a relay. The agents share candidate availability, not the titles or descriptions of existing calendar events. The hub routes messages and provides discovery and offline delivery; the agents choose the slot and write to their own calendars.

The repository includes a Node.js reference agent, a Flutter app with a Dart agent, and a shared JSON protocol. The app supports manual scheduling and a Turkish natural-language preview. The scheduling demo can use synthetic calendars without a language model.

```text
apps/hub          Relay, directory, mailbox, and request preview
apps/agent-node   Independent reference agent (Node.js + SQLite)
apps/mobile       Flutter application (Android + iOS)
packages/protocol Portable message schemas, fixtures, and validator
packages/runtime  Shared CLI validation and structured logging
scripts           Local orchestration and environment checks
tests             Protocol and real-network integration tests
docs/decisions    Architecture decisions
docs/evidence     Small reproducible validation records
```

## Setup

Use Node.js 26 and npm 11. Mobile development also requires Flutter 3.38.7 (Dart 3.10.7). Docker is needed for the bundled PostgreSQL and network lab; an existing PostgreSQL instance can replace the bundled database.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run doctor
```

For Flutter, run `flutter pub get` in `apps/mobile`. See the [architecture decision](docs/decisions/001-runtime-and-routing.md) for the relay and runtime design.

## Quick start: local protocol demo

```sh
cp .env.example .env
npm run local
```

This starts the M1 demo environment: one hub and three agents as four separate processes, with a SQLite directory per agent.
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
- `test`: the M1 Node protocol, unit, and integration suites.
- `test:gate:m1`: TypeScript check, JavaScript build, and the M1 Node suites.
- `test:regression`: an alias for the M1 gate.

Gate results go to `.state/evidence/m1/`; demo results go to `.state/evidence/demo-m1/`.
Set `M1_EVIDENCE_DIR` to choose the gate destination. Reports contain the code commit, dirty-worktree flag,
runtime/dependency versions, synthetic test data, retry settings, outcome metrics, and sampled structured logs.
The [M1 status record](docs/m1-status.md) documents commands and remaining manual checks.
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

## Scheduling, mobile, and evaluation

| Area | How to run or review |
| --- | --- |
| Deterministic scheduling (M3) | [Scheduling guide](docs/m3.md) and [recorded runs](docs/evidence/m3/runs.json) |
| Degraded networks (M4) | [Network lab guide](infra/network/README.md) and [recorded results](docs/evidence/m4/README.md) |
| Flutter/Dart and Google Calendar | [Mobile setup and device demo](apps/mobile/README.md) |
| Natural-language preview and semantic discovery | [Model setup](docs/m5-intelligence.md) and [model evaluation](docs/evidence/m5/intelligence/README.md) |
| Mixed Node/Dart scheduling (M5) | [Verification commands and outstanding checks](docs/evidence/m5/README.md) |

The recorded mixed Node/Dart run used synthetic calendars. An unsigned iOS build succeeded during development, but installation and launch still need verification. The Android debug build stopped during native toolchain setup. The live Google Calendar exercise and full network matrix are not part of the completed verification. See the evidence records for the individual results and their limits.
