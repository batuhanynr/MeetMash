// Lab preload. Each fork gets fresh counters. Frames here are serialization-layer
// bytes immediately before TLS. The WSS transport still signs and verifies them.
import { WebSocket } from 'ws';
import { readFileSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { signMessage } from '../../packages/protocol/src/mac.ts';
const profile = process.env.M4_FAULT;
const send = WebSocket.prototype.send;
let armed = true;
let allowCurrentVoteAt = 0;

WebSocket.prototype.send = function (data, ...rest) {
  const m = JSON.parse(data.toString());
  const trace = (event) =>
    writeSync(
      1,
      JSON.stringify({
        event,
        agentId: process.env.M4_NODE,
        meetingId: m.meetingId,
        messageId: m.messageId,
        ackFor: m.payload?.ackForMessageId,
        messageType: m.type,
        from: m.fromAgentId,
        to: m.toAgentId,
      }) + '\n',
    );
  if (
    armed &&
    ((profile === 'first-request' && m.type === 'REQUEST' && m.toAgentId === 'agent-c') ||
      (profile === 'first-ack' && m.type === 'ACK' && m.payload.scope === 'recipient.persisted'))
  ) {
    armed = false;
    trace('fault.drop');
    return;
  }
  if (profile === 'duplicate-confirm' && m.type === 'CONFIRM') {
    trace('fault.triple');
    send.call(this, data, ...rest);
    send.call(this, data, ...rest);
  }
  if (armed && profile === 'pause-commit' && m.type === 'CONFIRM' && m.payload.phase === 'COMMIT') {
    armed = false;
    trace('fault.pause');
    process.kill(process.pid, 'SIGSTOP');
  }
  if (armed && profile === 'old-round' && m.type === 'ACCEPT') {
    armed = false;
    const { pairKeys } = JSON.parse(readFileSync(process.env.SECRETS_FILE));
    const stale = signMessage(
      { ...m, messageId: randomUUID(), nonce: randomUUID(), roundId: 'retired-round' },
      pairKeys[m.auth.keyId],
      m.auth.keyId,
    );
    trace('fault.old_round');
    send.call(this, JSON.stringify(stale), ...rest);
    allowCurrentVoteAt = Date.now() + 1500;
  }
  if (profile === 'old-round' && m.type === 'ACCEPT' && Date.now() < allowCurrentVoteAt) {
    setTimeout(() => {
      if (this.readyState === WebSocket.OPEN) send.call(this, data, ...rest);
    }, allowCurrentVoteAt - Date.now());
    return;
  }
  return send.call(this, data, ...rest);
};
