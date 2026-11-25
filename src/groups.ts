import { Bot, ReceiverMode, type DataPacket, type GroupMessageEvent } from 'qq-official-bot';
import type { Config } from './config.js';
import { ModelHttpError } from './llm.js';

export class GroupBot extends Bot<ReceiverMode.WEBHOOK> {
  override dispatchEvent(type: string, packet: DataPacket) {
    // SDK 1.2.3 maps both GROUP_MESSAGE_CREATE and GROUP_AT_MESSAGE_CREATE to message.group.
    const data = packet.d;
    if (type !== 'GROUP_AT_MESSAGE_CREATE' || !data || typeof data.content !== 'string') return;
    const author = data.author;
    if (!author || author.bot || [author.id, author.member_openid].some(id => id && (id === this.self_id || id === this.config.appid))) return;
    const group = data.group_openid || data.group_id;
    if (typeof group !== 'string' || !group || typeof data.id !== 'string' || !data.id) return;
    // Only the current message's content enters the text parser. Reference/attachment structs stay out.
    const content = data.content.replace(/<@!?[^<>\s]+>/g, '').trim();
    if (!content) return;
    super.dispatchEvent(type, {...packet, d: {id: data.id, group_id: group, content, author, timestamp: data.timestamp, mentions: []}});
  }
}

function logStage(stage: string, started: number, status?: number) {
  console.info(JSON.stringify({stage, elapsed_ms: Date.now() - started, status}));
}

export function createGroupBot(config: Config, answer: (question: string) => Promise<string>) {
  const bot = new GroupBot({
    appid: config.appid, secret: config.secret, sandbox: config.sandbox, removeAt: true,
    intents: ['GROUP_AND_C2C_EVENT'], mode: ReceiverMode.WEBHOOK, port: 3000, path: '/qq/callback',
    logLevel: 'off'
  });
  // SDK 1.2.3 omits the required msg_type field for plain text replies.
  bot.request.interceptors.request.use(request => {
    if (request.method === 'post' && /^\/v2\/groups\/[^/]+\/messages$/.test(request.url ?? '') &&
        typeof request.data?.content === 'string' && request.data.msg_type === undefined) {
      request.data.msg_type = 0;
    }
    return request;
  });
  const seen = new Set<string>();
  bot.on('message.group', async (event: GroupMessageEvent) => {
    const segments = Array.isArray(event.message) ? event.message : [event.message];
    const question = segments.map(s => typeof s === 'object' && s.type === 'text' ? s.data.text : '').join('').trim();
    if (!question) return;
    const key = JSON.stringify([event.group_id, event.message_id]);
    if (seen.has(key)) return;
    seen.add(key);
    setTimeout(() => seen.delete(key), 600_000).unref();
    const started = Date.now();
    logStage('group_at_received', started);
    let text: string;
    try {
      text = await answer(question);
      logStage('model_answered', started);
    } catch (error) {
      logStage('model_failed', started, error instanceof ModelHttpError ? error.status : undefined);
      text = '暂时无法回答，请稍后重新 @ 我。';
    }
    const sending = Date.now();
    try {
      // Passing a text element prevents SDK markup parsing of the model's answer.
      await event.reply({type: 'text', data: {text}});
      logStage('qq_replied', sending);
    } catch (error) {
      const code = error instanceof Error && error.message.match(/failed with code\((\d+)\)/);
      logStage('qq_reply_failed', sending, code ? Number(code[1]) : undefined);
    }
  });
  return bot;
}
