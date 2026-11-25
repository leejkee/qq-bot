export function readConfig(env: NodeJS.ProcessEnv) {
  const keys = ['BOT_APPID', 'BOT_SECRET', 'BOT_SANDBOX', 'LLM_CHAT_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
  const missing = keys.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error('缺少 ' + missing.join(', '));
  const url = URL.parse(env.LLM_CHAT_URL!);
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('LLM_CHAT_URL 无效');
  if (!['true', 'false'].includes(env.BOT_SANDBOX!)) throw new Error('BOT_SANDBOX 需要 true 或 false');
  const search = env.LLM_WEB_SEARCH?.trim() ?? 'false';
  if (search !== 'true' && search !== 'false') throw new Error('LLM_WEB_SEARCH 需要 true 或 false');
  if (search === 'true' &&
      (url.origin !== 'https://api.deepseek.com' || !['/chat/completions', '/v1/chat/completions'].includes(url.pathname))) {
    throw new Error('LLM_WEB_SEARCH 需要 DeepSeek 官方 Chat Completions 地址');
  }
  return {
    appid: env.BOT_APPID!.trim(), secret: env.BOT_SECRET!, sandbox: env.BOT_SANDBOX === 'true',
    llm: {url: url.href, key: env.LLM_API_KEY!, model: env.LLM_MODEL!.trim(), webSearch: search === 'true'}
  };
}
export type Config = ReturnType<typeof readConfig>;
