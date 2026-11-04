# 001: Runtime and routing

Status: accepted for M1.

## Runtime and repository

- npm workspaces manage `apps/hub`, `apps/agent-node`, and `packages/protocol`.
- Flutter owns `apps/mobile` and its pub lockfile. It is not an npm workspace.
- Node 26 provides SQLite, the test runner, and direct TypeScript execution. TypeScript also emits JavaScript for a build check.
- The installed Flutter SDK and npm/pub caches are reused. No SDK upgrade is part of M1.
- JSON schemas and fixtures are language independent. Dart will implement the same contract in M5; it will not execute TypeScript.

## Routing adaptation

The proposal describes registrar lookups of agent IP/port and direct communication.
M1 instead uses a loopback WebSocket relay with a fixed allowlist and one active connection per agent.
Outbound connections simplify local process orchestration and prepare for mobile NAT and changing addresses.
This is a relay adaptation, not direct peer-to-peer communication. It does not implement directory discovery or a durable hub mailbox.

M1 is restricted to loopback WS. TLS, authenticated sessions, MACs, and nonce replay protection belong to M2.
TLS alone will not imply end-to-end encryption through the relay. Never send real calendar data or credentials through the M1 demo.

## Responsibility and dependency boundaries

- Protocol: envelope, payload schemas, validation, and portable examples.
- Hub: connections and routing; it never selects meeting slots.
- Agent application: inbox/outbox delivery policy and one synthetic effect per logical message.
- Agent ports: narrow storage and transport interfaces; SQLite and WebSocket are adapters injected by the entry point.
- Scenario driver: scripted messages and assertions; scheduling decisions are not hidden in the transport or agent.

No empty scheduler, calendar, AI, or discovery abstractions are added before their milestones need them.
M1-M4 agents run as independent Node processes. M5 adds a real foreground Dart agent participating in negotiation.
Persistent background execution and push wakeups are outside the initial mobile scope.
