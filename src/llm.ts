import type { Config } from './config.js';

export class ModelHttpError extends Error {
  constructor(readonly status: number) { super('model HTTP error'); }
}

export function createAnswer(config: Config['llm'], request = fetch) {
  return async (question: string): Promise<string> => {
    const response = await request(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: {authorization: 'Bearer ' + config.key, 'content-type': 'application/json'},
      body: JSON.stringify({model: config.model, stream: false, messages: [{role: 'user', content: question}]})
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelHttpError(response.status);
    }
    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('empty model answer');
    return answer.trim();
  };
}
