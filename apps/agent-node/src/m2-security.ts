import { readFileSync } from 'node:fs';
import { ProtocolError } from '../../../packages/protocol/src/index.ts';
import { messageHash, signMessage, verifyMessage } from '../../../packages/protocol/src/mac.ts';
import type { AgentSecurity } from './ports.ts';

export type PairKeys = Record<string, string>;
export type Secrets = { bootstrap: Record<string, string>; pairKeys: PairKeys };

// Pair keys are symmetric and addressed by the sorted agent pair, so both ends derive the same keyId and key.
export const pairId = (a: string, b: string): string => [a, b].sort().join(':');

export function loadSecrets(path: string): Secrets {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Secrets>;
  if (!parsed.bootstrap || !parsed.pairKeys) throw new Error('Secrets file must contain bootstrap and pairKeys');
  return { bootstrap: parsed.bootstrap, pairKeys: parsed.pairKeys };
}

export function buildSecurity(selfId: string, pairKeys: PairKeys, remember: (nonce: string, hash: string, expiresAt: number) => boolean): AgentSecurity {
  const keyFor = (peer: string): string => {
    const key = pairKeys[pairId(selfId, peer)];
    if (!key) throw new ProtocolError('KEY_UNKNOWN', `No pair key for ${selfId} and ${peer}`);
    return key;
  };
  return {
    sign: message => signMessage(message, keyFor(message.toAgentId), pairId(selfId, message.toAgentId)),
    verify: message => {
      if (!verifyMessage(message, keyFor(message.fromAgentId))) throw new ProtocolError('MAC_INVALID', 'Message MAC does not match the signed content');
      // Replay guard applies to work-bearing messages; ACKs are idempotent receipts and need no nonce history.
      if (message.type !== 'ACK') remember(message.nonce, messageHash(message), Date.parse(message.expiresAt));
    },
  };
}
