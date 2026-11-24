export type Visibility = 'private' | 'friends' | 'public';
export type Profile = { agentId: string; displayName: string; visibility: Visibility };

// Reads and writes the directory. The Postgres adapter implements this; the service depends only on it.
export interface DirectoryStore {
  upsertProfile(profile: Profile): Promise<void>;
  setVisibility(agentId: string, visibility: Visibility): Promise<void>;
  addFriend(ownerAgentId: string, friendAgentId: string): Promise<void>;
  getProfile(agentId: string): Promise<Profile | undefined>;
  findByName(normalizedName: string): Promise<Profile[]>;
  isFriend(ownerAgentId: string, candidateAgentId: string): Promise<boolean>;
}

export const normalize = (value: string): string => value.trim().toLowerCase();

type Entry = { expires: number; value: Profile[] };

export class Directory {
  private readonly store: DirectoryStore;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, Entry>();

  constructor(store: DirectoryStore, now: () => number = Date.now, ttlMs = 30_000) {
    this.store = store;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  // A requester may see a profile only when it is public, is their own, or is a friend-scoped profile they are a friend of.
  private async canSee(requesterAgentId: string, profile: Profile): Promise<boolean> {
    if (profile.visibility === 'public' || profile.agentId === requesterAgentId) return true;
    if (profile.visibility === 'friends') return this.store.isFriend(profile.agentId, requesterAgentId);
    return false;
  }

  private async filter(requesterAgentId: string, profiles: Profile[]): Promise<Profile[]> {
    const visible: Profile[] = [];
    for (const profile of profiles) if (await this.canSee(requesterAgentId, profile)) visible.push(profile);
    return visible;
  }

  private async cached(key: string, requester: string, matches: (profile: Profile) => boolean, load: () => Promise<Profile[]>): Promise<Profile[]> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) {
      const visible: Profile[] = [];
      for (const previous of hit.value) {
        const current = await this.store.getProfile(previous.agentId);
        if (current && matches(current) && await this.canSee(requester, current)) visible.push(current);
      }
      return visible;
    }
    const value = await load();
    this.cache.set(key, { expires: this.now() + this.ttlMs, value });
    return value;
  }

  async lookup(requesterAgentId: string, agentId: string): Promise<Profile | undefined> {
    const [match] = await this.cached(JSON.stringify(['id', requesterAgentId, agentId]), requesterAgentId, () => true, async () => {
      const profile = await this.store.getProfile(agentId);
      return profile ? this.filter(requesterAgentId, [profile]) : [];
    });
    return match;
  }

  async searchByName(requesterAgentId: string, name: string): Promise<Profile[]> {
    const normalized = normalize(name);
    return this.cached(JSON.stringify(['name', requesterAgentId, normalized]), requesterAgentId, p => normalize(p.displayName) === normalized, async () => this.filter(requesterAgentId, await this.store.findByName(normalized)));
  }

  async putProfile(profile: Profile): Promise<void> {
    await this.store.upsertProfile(profile);
    this.invalidate();
  }

  async setVisibility(agentId: string, visibility: Visibility): Promise<void> {
    await this.store.setVisibility(agentId, visibility);
    this.invalidate();
  }

  async addFriend(ownerAgentId: string, friendAgentId: string): Promise<void> {
    await this.store.addFriend(ownerAgentId, friendAgentId);
    this.invalidate();
  }

  // Any mutation clears cached results so a visibility change takes effect before the TTL elapses.
  invalidate(): void { this.cache.clear(); }
}
