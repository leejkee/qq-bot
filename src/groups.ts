import { Bot, ReceiverMode, type DataPacket, type GroupMessageEvent } from 'qq-official-bot';
import type { Config } from './config.js';
import type { GroupConversation } from './conversation.js';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

export class GroupBot extends Bot<ReceiverMode.WEBHOOK> {
  private probeKey?: Buffer;
  enableEventProbe() {
    this.probeKey = randomBytes(32);
  }
  readonly pendingReplies = new Set<Promise<void>>();
  override dispatchEvent(type: string, packet: DataPacket) {
    // SDK 1.2.3 maps both GROUP_MESSAGE_CREATE and GROUP_AT_MESSAGE_CREATE to message.group.
    const data = packet.d;
    if (this.probeKey && data && (type === 'GROUP_MESSAGE_CREATE' || type === 'GROUP_AT_MESSAGE_CREATE')) {
      const group = data.group_openid || data.group_id;
      const messageTag = typeof group === 'string' && typeof data.id === 'string'
        ? createHmac('sha256', this.probeKey).update(JSON.stringify([group, data.id])).digest('hex').slice(0, 24)
        : undefined;
      const mentions: unknown[] = Array.isArray(data.mentions) ? data.mentions : [];
      const mentionsSelf = mentions.some(value => {
        if (!value || typeof value !== 'object' || !('id' in value)) return false;
        return Boolean(value.id && (value.id === this.self_id || value.id === this.config.appid));
      });
      console.info(JSON.stringify({
        stage: 'qq_group_event_probe', event_type: type, message_tag: messageTag,
        has_mentions: Array.isArray(data.mentions), mention_count: mentions.length, mentions_self_by_id: mentionsSelf,
        has_reference: Boolean(data.message_reference), has_scene_ext: Array.isArray(data.message_scene?.ext),
        has_elements: Array.isArray(data.msg_elements), has_attachments: Boolean(data.attachments?.length)
      }));
    }
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

export function createGroupBot(config: Pick<Config, 'appid' | 'secret' | 'sandbox'> & {eventProbe?: boolean}, answer: GroupConversation) {
  const bot = new GroupBot({
    appid: config.appid, secret: config.secret, sandbox: config.sandbox, removeAt: true,
    intents: ['GROUP_AND_C2C_EVENT'], mode: ReceiverMode.WEBHOOK, port: 3000, path: '/qq/callback',
    logLevel: 'off'
  });
  if (config.eventProbe) bot.enableEventProbe();
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
          timestamp: new Date().toISOString(),
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
  async function handleMessage(event: GroupMessageEvent) {
    const segments = Array.isArray(event.message) ? event.message : [event.message];
    const question = segments.map(s => typeof s === 'object' && s.type === 'text' ? s.data.text : '').join('').trim();
    if (!question) return;
    const key = JSON.stringify([event.group_id, event.message_id]);
    if (seen.has(key)) return;
    seen.add(key);
    setTimeout(() => seen.delete(key), 600_000).unref();
    const started = Date.now();
    const requestId = randomUUID();
    const logStage = (stage: string, since: number, details: Record<string, unknown> = {}) => {
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(), stage, request_id: requestId,
        elapsed_ms: Date.now() - since, ...details
      }));
    };
    logStage('group_at_received', started, {question_bytes: Buffer.byteLength(question)});
    const reply = (content: string, sequence: number) => {
      const body = {content, msg_type: 0, msg_id: event.message_id, msg_seq: sequence};
      logStage('qq_reply_sending', started, {
        msg_type: body.msg_type, msg_seq: body.msg_seq, has_msg_id: Boolean(body.msg_id),
        content_bytes: Buffer.byteLength(content), has_newlines: /[\r\n]/.test(content),
        has_mention_markup: /<qqbot-at-|<@/i.test(content)
      });
      return bot.request.post(`/v2/groups/${encodeURIComponent(event.group_id)}/messages`, body);
    };
    const ackStarted = Date.now();
    try {
      await reply('正在烧脑中，请稍后...', 1);
      logStage('qq_ack_sent', ackStarted);
    } catch {
      logStage('qq_ack_failed', ackStarted);
    }
    const modelStarted = Date.now();
    let text: string;
    const result = await answer(question);
    if (result.ok) {
      text = result.text;
      logStage('model_answered', modelStarted);
    } else {
      logStage('model_failed', modelStarted, {
        reason: result.reason, status: result.status
      });
      text = '暂时无法回答，请稍后重新 @ 我。';
    }
    const sending = Date.now();
    try {
      // Send the answer as plain text with its own passive reply sequence.
      const receipt = await reply(text, 2);
      if (config.eventProbe) logStage('qq_reply_receipt_probe', sending, {
        has_message_id: typeof receipt.data?.id === 'string' && receipt.data.id.length > 0
      });
      logStage('qq_replied', sending);
    } catch (error) {
      const code = error instanceof Error && error.message.match(/failed with code\((\d+)\)/);
      logStage('qq_reply_failed', sending, {qq_code: code ? Number(code[1]) : undefined});
    }
  }
  bot.on('message.group', async (event: GroupMessageEvent) => {
    const reply = handleMessage(event);
    bot.pendingReplies.add(reply);
    try {
      await reply;
    } finally {
      bot.pendingReplies.delete(reply);
    }
  });
  return bot;
}
