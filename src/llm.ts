import {AnswerError, type ChatMessage} from './conversation.js';

type ModelConfig = {url: string; key: string; model: string; webSearch: boolean};

export function isDeepSeekChatEndpoint(url: URL) {
  return url.origin === 'https://api.deepseek.com' &&
    ['/chat/completions', '/v1/chat/completions'].includes(url.pathname);
}

function containsWebLink(message: ChatMessage | undefined) {
  if (message?.role !== 'user') return false;
  const links = message.content.match(/\bhttps?:\/\/[^\s<>"“”‘’`，。！？；、]+/gi);
  return links?.some(link => URL.canParse(link)) ?? false;
}

export function createCompletion(config: ModelConfig, request = fetch) {
  const endpoint = URL.parse(config.url);
  const supportsReadUrl = config.model === 'deepseek-flash' && endpoint !== null && isDeepSeekChatEndpoint(endpoint);
  return async (messages: readonly ChatMessage[]): Promise<string> => {
    const readUrl = supportsReadUrl && containsWebLink(messages.at(-1));
    const tools = [];
    if (config.webSearch) tools.push({type: 'deepseek_web_search'});
    if (readUrl) tools.push({type: 'deepseek_read_url'});
    // DeepSeek skips standalone link reading when thinking and search are both enabled.
    const webTools = tools.length ? {
      tools, thinking: {type: readUrl ? 'disabled' : 'enabled'}
    } : {};
    const response = await request(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: {authorization: 'Bearer ' + config.key, 'content-type': 'application/json'},
      body: JSON.stringify({model: config.model, stream: false, messages, ...webTools})
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AnswerError('http_error', response.status);
    }
    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    const answer = message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new AnswerError('empty_answer');
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
