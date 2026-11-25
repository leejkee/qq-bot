export function readConfig(env: NodeJS.ProcessEnv) {
  const keys = ['BOT_APPID', 'BOT_SECRET', 'BOT_SANDBOX', 'LLM_CHAT_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
  const missing = keys.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error('缺少 ' + missing.join(', '));
  const url = URL.parse(env.LLM_CHAT_URL!);
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('LLM_CHAT_URL 无效');
  if (!['true', 'false'].includes(env.BOT_SANDBOX!)) throw new Error('BOT_SANDBOX 需要 true 或 false');
  return {
    appid: env.BOT_APPID!.trim(), secret: env.BOT_SECRET!, sandbox: env.BOT_SANDBOX === 'true',
    llm: {url: url.href, key: env.LLM_API_KEY!, model: env.LLM_MODEL!.trim()}
  };
}
export type Config = ReturnType<typeof readConfig>;
