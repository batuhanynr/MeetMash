import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface LanguageModel {
  extract(system: string, text: string, schema: object): Promise<unknown>;
}

export class OpenRouter implements LanguageModel {
  async extract(system: string, text: string, schema: object): Promise<unknown> {
    const key = process.env.OPENROUTER_API_KEY?.trim() ||
      readFileSync(join(homedir(), '.config/meetmesh/openrouter-api-key'), 'utf8').trim();
    if (!key) throw new Error('OpenRouter API key is missing');
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? 'google/gemini-3.5-flash-lite',
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'meeting_draft', strict: true, schema } },
      }),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`OpenRouter service unavailable (${response.status})`);
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    return JSON.parse(body.choices?.[0]?.message?.content ?? '');
  }
}
