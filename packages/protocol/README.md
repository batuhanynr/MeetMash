# Protocol v1

`schemas/message.schema.json` is the portable JSON Schema (draft 7).
`fixtures/messages.json` contains valid and invalid vectors for every message type and valid phase/scope variants.
`errors.json` defines public error meanings. The TypeScript validator adds cross-field time ordering checks.
Future Dart implementations must run these same vectors and the semantic checks below.

- All envelope fields are required. Extra envelope and payload fields are rejected.
- Times use RFC3339 with `T`, `Z` or explicit offset, seconds 00-59, and at most three fractional digits. Calendar dates must exist. `expiresAt > createdAt`; every slot/window has `end > start`.
- `sequence` is a durable increasing positive integer per **sender, receiver, meeting**. Gaps are observations, never automatic acceptance or proof of loss. Retries preserve sequence and the entire logical envelope, including ID, nonce, timestamps, and payload.
- `PROPOSE` distinguishes `AVAILABILITY` (free slots) and `SELECTION` (one candidate). `CONFIRM` distinguishes `PREPARE`, `COMMIT`, and `APPLIED`. M1 transports these; it does not implement scheduling, distributed commit, or calendars.
- Each group recipient gets a distinct message ID, sequence stream, and outbox status. ACK for B never acknowledges delivery to C.
- `ACK.payload.ackForMessageId` is mandatory. `recipient.persisted` means the recipient stored the inbox and pending work atomically. It does not mean meeting acceptance. `relay.persisted` is reserved for the M2 durable relay; M1 never emits it or treats it as recipient delivery.
- ACK does not request ACK. An ACK is bound to the original recipient and meeting. It only changes the matching outbox row.
- `auth` is an empty object in M1. The local allowlist is not authentication; M2 defines the real auth/MAC contract.
- The default first-delivery TTL is 180 seconds. A new expired message cannot create work; an already persisted duplicate can still be ACKed. Pending durable work survives transport expiry and process restart.
- Duplicate identity compares the whole envelope using recursively sorted object keys; arrays retain order. Reuse with different content is `MESSAGE_ID_CONFLICT`.
- M1 domain effect is one durable synthetic counter row per received non-ACK message. This is not a calendar side effect or an exactly-once network delivery guarantee.

Connection control frames (`kind: ready` / `kind: error`) are local transport metadata, outside the six-message agent protocol. Agent IDs are supplied in the loopback WebSocket connection query. They are not user credentials.
