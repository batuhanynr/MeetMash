import type { Profile } from '../directory.ts';
import type { EmbeddingModel } from './ollama.ts';

const description = (profile: Profile) => profile.capabilities.join('. ').slice(0, 4096);
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) throw new Error('Embedding dimensions differ');
  let product = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    product += x * y; normA += x * x; normB += y * y;
  }
  if (!normA || !normB) throw new Error('Empty embedding');
  return product / Math.sqrt(normA * normB);
}

export class SemanticDirectory {
  private readonly model: EmbeddingModel;
  private readonly visible: (viewer: string) => Promise<Profile[]>;
  private readonly vectors = new Map<string, number[]>();
  constructor(model: EmbeddingModel, visible: (viewer: string) => Promise<Profile[]>) {
    this.model = model; this.visible = visible;
  }

  async search(viewer: string, query: string): Promise<Profile[]> {
    if (!query.trim() || query.length > 512) throw new Error('Invalid search term');
    const candidates = (await this.visible(viewer)).filter(p => description(p));
    if (!candidates.length) return [];
    const texts = [...new Set(candidates.map(description))];
    const vectors = new Map(texts.map(text => [text, this.vectors.get(text)]));
    const missing = texts.filter(text => !vectors.get(text));
    for (let i = 0; i < missing.length; i += 32) {
      const batch = missing.slice(i, i + 32), result = await this.model.embed(batch);
      batch.forEach((text, j) => {
        if (this.vectors.size >= 2048) this.vectors.delete(this.vectors.keys().next().value!);
        this.vectors.set(text, result[j]!);
        vectors.set(text, result[j]!);
      });
    }
    const [queryVector] = await this.model.embed([query]);
    const rank = new Map(candidates.map(p => [p.agentId, { text: description(p), score: cosine(queryVector!, vectors.get(description(p))!) }]));
    // Permissions or capabilities may have changed while the model was running.
    return (await this.visible(viewer)).filter(p => rank.get(p.agentId)?.text === description(p))
      .sort((a, b) => rank.get(b.agentId)!.score - rank.get(a.agentId)!.score || a.agentId.localeCompare(b.agentId)).slice(0, 3);
  }
}
