import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, type Message } from './index.ts';

// The signed bytes cover every envelope field except auth itself. Key order is canonical so Node and a
// future Dart agent sign the same string. auth is excluded because it carries the signature.
export function signingString(message: Message): string {
  return canonicalJson({
    protocolVersion: message.protocolVersion, messageId: message.messageId, meetingId: message.meetingId,
    fromAgentId: message.fromAgentId, toAgentId: message.toAgentId, type: message.type, sequence: message.sequence,
    createdAt: message.createdAt, expiresAt: message.expiresAt, nonce: message.nonce, payload: message.payload,
  });
}

export function signMessage(message: Message, key: string, keyId: string): Message {
  const mac = createHmac('sha256', key).update(signingString(message)).digest('hex');
  return { ...message, auth: { mac, keyId } };
}

export function verifyMessage(message: Message, key: string): boolean {
  const presented = message.auth.mac;
  if (!presented) return false;
  const expected = createHmac('sha256', key).update(signingString(message)).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Binds a nonce to the exact content it was first seen with, so a legitimate retransmit matches but a
// replay carrying different content does not.
export function messageHash(message: Message): string {
  return createHash('sha256').update(signingString(message)).digest('hex');
}
