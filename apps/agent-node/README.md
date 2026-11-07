# Reference agent

From the repository root, after starting the hub:

```sh
node apps/agent-node/src/main.ts --id agent-a
```

Start `agent-b` and `agent-c` in separate terminals. State is stored under `.state/local/<agent-id>/agent.sqlite`.
Each directory stores its owner ID; a separate SQLite exclusive lock prevents concurrent processes from using it.
The OS releases this lock after an abrupt process death. Do not copy state between identities.

Arguments: `--id`, `--hub`, `--state-root`, `--run-id`, `--ack-timeout-ms` (1000),
`--max-backoff-ms` (8000), `--max-retries` (5 retries after the first attempt).
Test-only faults: `--drop-acks <count>`, `--drop-messages <count>`, `--pause-after-persist true`.
All option values are explicit. Faults are off by default.

Standard input accepts local JSON-line commands. Examples:

```json
{"command":"status"}
{"command":"send","toAgentId":"agent-b","meetingId":"manual-demo","type":"REJECT","payload":{"reasonCode":"DECLINED"}}
```

The scenario runner uses the same control surface through process IPC; agent messages travel over WebSocket.
Control responses and JSON event logs are written to stdout. Default logs contain identifiers and outcomes, not payloads.

Storage, transport, and sequence ports are injected into the delivery application.
Inbox and pending work are written in one SQLite transaction before ACK. The synthetic effect and work completion
are committed together in another transaction. This supports at-least-once delivery with one local effect per logical message.
ACKs do not themselves request ACKs. Only `recipient.persisted` changes M1 delivery status.

Retries preserve the original envelope, use capped exponential backoff, and leave a visible `DELIVERY_UNCONFIRMED`
row after exhaustion. They do not imply rejection or acceptance of a meeting. Expired new deliveries are rejected.
Restart the process to resume durable pending work and outbox attempts after a connection loss; automatic reconnection belongs to M2.
