// Server-only inference. The mobile client receives a draft or visible search results.
export interface LanguageModel {
  extract(system: string, text: string, schema: object): Promise<unknown>;
}
export interface EmbeddingModel {
  embed(inputs: string[]): Promise<number[][]>;
}
export class Ollama implements LanguageModel, EmbeddingModel {
  readonly origin: URL;
  readonly chatModel: string;
  readonly embeddingModel: string;

  constructor(env = process.env) {
    this.origin = new URL(env.MEETMESH_MODEL_URL ?? 'http://127.0.0.1:11434');
    if (this.origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(this.origin.hostname)) {
      throw new Error('MEETMESH_MODEL_URL must point to a local Ollama server');
    }
    this.chatModel = env.MEETMESH_CHAT_MODEL ?? 'qwen3:4b';
    this.embeddingModel = env.MEETMESH_EMBEDDING_MODEL ?? 'bge-m3';
  }

  private async post(path: string, payload: object) {
    const response = await fetch(new URL(path, this.origin), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Model service unavailable');
    return response.json();
  }

  async extract(system: string, text: string, schema: object): Promise<unknown> {
    const response = await this.post('/api/chat', {
      model: this.chatModel, messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      stream: false, think: false, format: schema, options: { temperature: 0, seed: 476, num_predict: 600 },
    }) as { message?: { content?: string } };
    return JSON.parse(response.message?.content ?? '');
  }

  async embed(inputs: string[]): Promise<number[][]> {
    const response = await this.post('/api/embed', { model: this.embeddingModel, input: inputs, truncate: false }) as { embeddings?: number[][] };
    const vectors = response.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== inputs.length || vectors.some(v => !Array.isArray(v) || !v.length || !v.every(Number.isFinite))) {
      throw new Error('Invalid embedding response');
    }
    return vectors;
  }
}
