import {readConfig} from './config.js';
import {createGroupBot} from './groups.js';
import {createAnswer} from './llm.js';

function load() {
  try { return readConfig(process.env); }
  catch (error) {
    console.error('/etc/qqbot/qqbot.env', error instanceof Error ? error.message : '配置无效');
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
  console.info('qq_webhook_ready');
} catch {
  console.error('qq_start_failed');
  process.exit(1);
}
