import {loadConfig} from './config.js';
import {createGroupBot} from './groups.js';
import {createAnswer} from './llm.js';

function load() {
  try { return loadConfig(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : '配置无效');
    process.exit(78);
  }
}
const config = load();
const bot = createGroupBot(config, createAnswer(config.llm));
try {
  // Await the SDK operations directly: its Session.start does not propagate async token/port failures.
  await bot.sessionManager.getAccessToken();
  bot.self_id = (await bot.getSelfInfo()).id;
  await bot.receiver.start(bot.sessionManager);
  process.once('SIGTERM', async () => {
    try {
      await bot.receiver.stop(bot.sessionManager);
      await Promise.allSettled(bot.pendingReplies);
      process.exit(0);
    } catch {
      console.error('qq_shutdown_failed');
      process.exit(1);
    }
  });
  console.info('qq_webhook_ready');
} catch {
  console.error('qq_start_failed');
  process.exit(1);
}
