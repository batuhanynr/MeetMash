import { previewMeeting } from './intent.ts';
import { SemanticDirectory } from './discovery.ts';
import { Ollama } from './ollama.ts';
import { normalize, type Profile } from '../directory.ts';

import type { HubControls } from '../hub-core.ts';

type Frame = { kind: string; [key: string]: unknown };
export class IntelligenceControls implements HubControls {
  private readonly model: Ollama;
  private readonly search: SemanticDirectory;
  private readonly visible: (requester: string) => Promise<Profile[]>;
  private readonly active = new Set<string>();
  constructor(visible: (requester: string) => Promise<Profile[]>, model = new Ollama()) {
    this.model = model; this.visible = visible; this.search = new SemanticDirectory(model, visible);
  }
  async handle(agentId: string, frame: Frame): Promise<Record<string, unknown> | undefined> {
    const preview = frame.kind === 'meeting.preview';
    if (!preview && !(frame.kind === 'directory.lookup' && frame.by === 'semantic')) return;
    const { requestId } = frame;
    if (typeof requestId !== 'string' || requestId.length > 128) return { kind: 'error', code: 'INVALID_REQUEST' };
    if (this.active.has(agentId) || this.active.size >= 8) return { kind: 'error', requestId, code: 'MODEL_BUSY' };
    this.active.add(agentId);
    try {
      if (preview) {
        const lookup = async (name: string) => (await this.visible(agentId)).filter(p => normalize(p.displayName) === normalize(name));
        const draft = await previewMeeting(this.model, lookup, agentId, typeof frame.text === 'string' ? frame.text : '',
          typeof frame.timeZone === 'string' ? frame.timeZone : '');
        return { kind: 'meeting.preview.result', requestId, ...draft };
      }
      try {
        const profiles = await this.search.search(agentId, typeof frame.term === 'string' ? frame.term : '');
        return { kind: 'directory.result', requestId, mode: 'semantic', agents: profiles.map(({ agentId, displayName }) => ({ agentId, displayName })) };
      } catch {
        return { kind: 'directory.result', requestId, mode: 'unavailable', agents: [] };
      }
    } finally { this.active.delete(agentId); }
  }
}
