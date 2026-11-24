import { previewMeeting } from './intent.ts';
import type { LanguageModel } from './openrouter.ts';
import { OpenRouter } from './openrouter.ts';
import { normalize, type Profile } from '../directory.ts';

import type { HubControls } from '../hub-core.ts';

type Frame = { kind: string; [key: string]: unknown };
export class IntelligenceControls implements HubControls {
  private readonly model: LanguageModel;
  private readonly visible: (requester: string) => Promise<Profile[]>;
  private readonly active = new Set<string>();
  constructor(visible: (requester: string) => Promise<Profile[]>, model: LanguageModel = new OpenRouter()) {
    this.model = model; this.visible = visible;
  }
  async handle(agentId: string, frame: Frame): Promise<Record<string, unknown> | undefined> {
    if (frame.kind !== 'meeting.preview') return;
    const { requestId } = frame;
    if (typeof requestId !== 'string' || requestId.length > 128) return { kind: 'error', code: 'INVALID_REQUEST' };
    if (this.active.has(agentId) || this.active.size >= 8) return { kind: 'error', requestId, code: 'MODEL_BUSY' };
    this.active.add(agentId);
    try {
      const lookup = async (name: string) => (await this.visible(agentId)).filter(p => normalize(p.displayName) === normalize(name));
      const draft = await previewMeeting(this.model, lookup, agentId, typeof frame.text === 'string' ? frame.text : '',
          typeof frame.timeZone === 'string' ? frame.timeZone : '');
      return { kind: 'meeting.preview.result', requestId, ...draft };
    } finally { this.active.delete(agentId); }
  }
}
