import {isAbsolute, resolve} from 'node:path';
import {isDeepSeekChatEndpoint} from './llm.js';

export function loadConfig() {
  if ((process.env.NODE_ENV ?? 'development') === 'development') {
    try {
      process.loadEnvFile('.env');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法加载开发环境 .env');
    }
  }
  return readConfig(process.env);
}

export function readConfig(env: NodeJS.ProcessEnv) {
  const keys = ['BOT_APPID', 'BOT_SECRET', 'BOT_SANDBOX', 'LLM_CHAT_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
  const missing = keys.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error('缺少 ' + missing.join(', '));
  const url = URL.parse(env.LLM_CHAT_URL!);
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('LLM_CHAT_URL 无效');
  if (!['true', 'false'].includes(env.BOT_SANDBOX!)) throw new Error('BOT_SANDBOX 需要 true 或 false');
  const search = env.LLM_WEB_SEARCH?.trim() ?? 'false';
  if (search !== 'true' && search !== 'false') throw new Error('LLM_WEB_SEARCH 需要 true 或 false');
  if (search === 'true' && !isDeepSeekChatEndpoint(url)) {
    throw new Error('LLM_WEB_SEARCH 需要 DeepSeek 官方 Chat Completions 地址');
  }
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('NODE_ENV 无效');
  function directory(key: string, fallback: string) {
    const path = env[key] ?? (mode === 'production' ? '' : fallback);
    if (!path.trim() || (mode === 'production' && !isAbsolute(path))) {
      throw new Error(key + ' 需要有效的目录路径，生产环境需要绝对路径');
    }
    return resolve(path);
  }
  return {
    configDir: directory('QQBOT_CONFIG_DIR', './config'),
    dataDir: directory('QQBOT_DATA_DIR', './data'),
    logDir: directory('QQBOT_LOG_DIR', './logs'),
    appid: env.BOT_APPID!.trim(), secret: env.BOT_SECRET!, sandbox: env.BOT_SANDBOX === 'true',
    llm: {url: url.href, key: env.LLM_API_KEY!, model: env.LLM_MODEL!.trim(), webSearch: search === 'true'}
  };
}
export type Config = ReturnType<typeof readConfig>;
