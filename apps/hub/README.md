# Local hub

From the repository root:

```sh
npm run hub
curl http://127.0.0.1:8787/health
```

Arguments: `--host`, `--port`, `--agents` (comma separated), `--run-id`.
Environment equivalents are in the root `.env.example`; arguments take precedence.
Only loopback binding is allowed. Port 0 asks the OS for an available port.
Duplicate IDs, unknown senders/recipients, spoofed senders, and malformed messages produce explicit errors.
This service routes validated messages without interpreting meeting decisions.
It has no durable offline mailbox in M1; the sender keeps its own outbox.
