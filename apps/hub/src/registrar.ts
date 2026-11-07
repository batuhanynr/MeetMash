import { ProtocolError } from '../../../packages/protocol/src/index.ts';
import { hashSecret, randomToken, verifySecret } from './secrets.ts';

export type SessionState = 'online' | 'offline';
export type StoredSession = { userId: string; generation: number; tokenHash: string; state: SessionState; lastSeen: number; endpoint: string | null };

// Binds a stable agent identity to one active authenticated session. The Postgres adapter implements this.
export interface RegistrarStore {
  getIdentity(agentId: string): Promise<{ userId: string; secretHash: string } | undefined>;
  rotateSession(input: { agentId: string; userId: string; tokenHash: string; endpoint: string | null; now: number }): Promise<number>;
  getSession(agentId: string): Promise<StoredSession | undefined>;
  touchSession(agentId: string, generation: number, now: number): Promise<boolean>;
  setSessionState(agentId: string, generation: number, state: SessionState, now: number): Promise<boolean>;
}

export type Registration = { token: string; generation: number };

export class Registrar {
  private readonly store: RegistrarStore;
  private readonly now: () => number;
  private readonly offlineAfterMs: number;

  constructor(store: RegistrarStore, now: () => number = Date.now, offlineAfterMs = 15_000) {
    this.store = store;
    this.now = now;
    this.offlineAfterMs = offlineAfterMs;
  }

  // A valid bootstrap secret rotates the session: a new generation and token, invalidating any earlier one.
  async register(agentId: string, secret: string, endpoint: string | null = null): Promise<Registration> {
    const identity = await this.store.getIdentity(agentId);
    if (!identity || !verifySecret(secret, identity.secretHash)) throw new ProtocolError('AUTH_FAILED', 'Unknown agent or wrong bootstrap secret');
    const token = randomToken();
    const generation = await this.store.rotateSession({ agentId, userId: identity.userId, tokenHash: hashSecret(token), endpoint, now: this.now() });
    return { token, generation };
  }

  // Proves the caller holds the current session token for agentId; a token issued to another agent cannot pass here.
  async authenticate(agentId: string, token: string): Promise<{ userId: string; generation: number }> {
    const session = await this.store.getSession(agentId);
    if (!session || !verifySecret(token, session.tokenHash)) throw new ProtocolError('SESSION_INVALID', 'No active session for this token');
    return { userId: session.userId, generation: session.generation };
  }

  async heartbeat(agentId: string, token: string): Promise<void> {
    const { generation } = await this.authenticate(agentId, token);
    await this.store.touchSession(agentId, generation, this.now());
  }

  async isOnline(agentId: string): Promise<boolean> {
    const session = await this.store.getSession(agentId);
    return !!session && session.state === 'online' && this.now() - session.lastSeen <= this.offlineAfterMs;
  }

  // Only the owning generation can mark itself offline, so a late close from a replaced session leaves the new one intact.
  async disconnect(agentId: string, generation: number): Promise<void> {
    await this.store.setSessionState(agentId, generation, 'offline', this.now());
  }
}
