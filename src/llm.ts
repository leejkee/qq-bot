import type { Config } from './config.js';

export class ModelHttpError extends Error {
  constructor(readonly status: number) { super('model HTTP error'); }
}

export function createAnswer(config: Config['llm'], request = fetch) {
  return async (question: string): Promise<string> => {
    const webTools = config.webSearch ? {
      tools: [{type: 'deepseek_web_search'}],
      thinking: {type: 'disabled'}
    } : {};
    const response = await request(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.webSearch ? 45_000 : 20_000),
      headers: {authorization: 'Bearer ' + config.key, 'content-type': 'application/json'},
      body: JSON.stringify({model: config.model, stream: false, messages: [{role: 'user', content: question}], ...webTools})
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelHttpError(response.status);
    }
    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    const answer = message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('empty model answer');
    const steps = message.server_tool_calls;
    if (config.webSearch && Array.isArray(steps) &&
        steps.some(step => Array.isArray(step?.calls) &&
          step.calls.some((call: {type?: string; status?: string} | null) =>
            call?.type === 'deepseek_web_search' && call.status === 'completed'))) {
      console.info(JSON.stringify({stage: 'llm_web_search_completed'}));
    }
    return answer.trim();
  };
}
