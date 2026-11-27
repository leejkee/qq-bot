import {readConfig} from './config.js';
import {createGroupBot} from './groups.js';
import {createCompletion} from './llm.js';
import {createGroupConversation} from './conversation.js';

const consoleProbe = process.argv.slice(2).includes('--console-probe');
function load() {
  try { return readConfig({...process.env, NODE_ENV: consoleProbe ? 'development' : process.env.NODE_ENV ?? 'production'}); }
  catch (error) {
    console.error(error instanceof Error ? error.message : '配置无效');
    process.exit(78);
  }
}
const config = load();
const conversation = createGroupConversation(createCompletion(config.llm), config.llm.systemPrompt);
const bot = createGroupBot({...config, consoleProbe}, conversation);
try {
  // Await the SDK operations directly: its Session.start does not propagate async token/port failures.
  await bot.sessionManager.getAccessToken();
  bot.self_id = (await bot.getSelfInfo()).id;
  await bot.receiver.start(bot.sessionManager);
  const shutdown = async () => {
    try {
      await bot.receiver.stop(bot.sessionManager);
      await Promise.allSettled(bot.pendingReplies);
      process.exit(0);
    } catch {
      console.error('qq_shutdown_failed');
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  if (consoleProbe) process.once('SIGINT', shutdown);
  console.info('qq_webhook_ready');
} catch {
  console.error('qq_start_failed');
  process.exit(1);
}
