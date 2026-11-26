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
  bot.request.interceptors.request.use(request => {
    if (request.method !== 'post' || !/^\/v2\/groups\/[^/]+\/messages$/.test(request.url ?? '')) {
      return request;
    }
    // SDK 1.2.3 omits the required msg_type field for plain text replies.
    if (typeof request.data?.content === 'string' && request.data.msg_type === undefined) {
      request.data.msg_type = 0;
    }
    const transforms = [request.transformResponse ?? []].flat();
    request.transformResponse = [...transforms, (data, headers, status) => {
      // The SDK response interceptor drops HTTP status and headers when throwing.
      if ((status ?? 0) >= 400 || (typeof data?.code === 'number' && data.code !== 0)) {
        const trace = headers.get('x-tps-trace-id');
        const message = typeof data?.message === 'string' ? data.message : '';
        const hints = [
          [/白名单|whitelist|allowlist/i, 'ip_allowlist'],
          [/沙箱|sandbox/i, 'sandbox'],
          [/审核|敏感|risk control|moderation/i, 'moderation'],
          [/权限|permission/i, 'permission'],
          [/msg_id|event_id|msg_seq/i, 'reply_reference']
        ] as const;
        console.info(JSON.stringify({
          stage: 'qq_reply_api_error', http_status: status,
          qq_code: typeof data?.code === 'number' ? data.code : undefined,
          trace_id: typeof trace === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(trace) ? trace : undefined,
          hint: hints.find(([pattern]) => pattern.test(message))?.[1],
          sandbox: config.sandbox
        }));
      }
      return data;
    }];
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
    const reply = (content: string, sequence: number) => bot.request.post(
      `/v2/groups/${encodeURIComponent(event.group_id)}/messages`,
      {content, msg_type: 0, msg_id: event.message_id, msg_seq: sequence}
    );
    try {
      await reply('正在烧脑中，请稍后...', 1);
    } catch {
      logStage('qq_ack_failed', started);
    }
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
      // Send the answer as plain text with its own passive reply sequence.
      await reply(text, 2);
      logStage('qq_replied', sending);
    } catch (error) {
      const code = error instanceof Error && error.message.match(/failed with code\((\d+)\)/);
      logStage('qq_reply_failed', sending, code ? Number(code[1]) : undefined);
    }
  });
  return bot;
}
