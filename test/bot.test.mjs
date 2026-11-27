import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey, sign, verify, createPublicKey} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConfig} from '../src/config.ts';
import {createGroupBot} from '../src/groups.ts';
import {createCompletion} from '../src/llm.ts';
import {createGroupConversation} from '../src/conversation.ts';

const env = {BOT_APPID: 'qq-app', BOT_SECRET: 'fixture!', BOT_SANDBOX: 'true',
  LLM_CHAT_URL: 'https://example.invalid/chat', LLM_API_KEY: 'fixture', LLM_MODEL: 'test-model'};
const config = readConfig(env);

test('config validation and restart with a changed model', () => {
  assert.equal(config.eventProbe, false);
  assert.throws(() => readConfig({...env, QQBOT_EVENT_PROBE: '1'}), /QQBOT_EVENT_PROBE/);
  const failed = spawnSync(process.execPath, ['--import','tsx','src/index.ts'], {env: {PATH: process.env.PATH, NODE_ENV: 'test'}, encoding: 'utf8'});
  assert.equal(failed.status, 78);
  assert.match(failed.stderr, /BOT_APPID/);
  assert.throws(() => readConfig({...env, NODE_ENV: 'production'}), /QQBOT_CONFIG_DIR/);
  assert.throws(() => readConfig({...env, NODE_ENV: 'production', QQBOT_CONFIG_DIR: './config'}), /QQBOT_CONFIG_DIR/);
  assert.throws(() => readConfig({...env,BOT_SANDBOX:'0'}), /BOT_SANDBOX/);
  assert.throws(() => readConfig({...env,LLM_CHAT_URL:'http://example.org'}), /LLM_CHAT_URL/);
  assert.equal(readConfig({...env,BOT_SANDBOX:'false',LLM_MODEL:'another'}).llm.model,'another');
});

test('a configured prompt file becomes a system message before the current question', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qq-bot-prompt-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const prompt = '请直接回答问题。\n需要时注明来源。';
  const filename = 'system-prompt.txt';
  const path = join(directory, filename);
  const settings = {...env, QQBOT_CONFIG_DIR: directory, LLM_SYSTEM_PROMPT_FILE: filename};
  assert.throws(() => readConfig(settings), /无法读取 LLM_SYSTEM_PROMPT_FILE/);
  writeFileSync(path, '  \n', 'utf8');
  assert.throws(() => readConfig(settings), /文件为空/);
  writeFileSync(path, prompt + '\n', 'utf8');
  const {llm} = readConfig(settings);
  assert.equal(readConfig({...settings, LLM_SYSTEM_PROMPT_FILE: path}).llm.systemPrompt, prompt);
  const complete = createCompletion(llm, async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).messages, [
      {role: 'system', content: prompt},
      {role: 'user', content: '你好'}
    ]);
    return Response.json({choices: [{message: {content: '你好！'}}]});
  });
  assert.deepEqual(await createGroupConversation(complete, llm.systemPrompt)('你好'), {ok: true, text: '你好！'});
});

test('signed webhook, independent questions, slow responses, redelivery and send failures', async t => {
  const requests = [], sends = [], logs = [];
  t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const slow = Promise.withResolvers();
  const complete = createCompletion(config.llm, async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const question = body.messages[0].content;
    if (question === 'slow') await slow.promise;
    if (question === 'timeout') throw new DOMException('timeout', 'TimeoutError');
    if (question === 'error') return new Response(null, {status: 503});
    return Response.json({choices: [{message: {content: question === 'empty' ? '  ' : '<image> '+question}}]});
  });
  const bot = createGroupBot(readConfig({...env, QQBOT_EVENT_PROBE: 'true'}), createGroupConversation(complete));
  bot.self_id = 'self';
  bot.request.defaults.adapter = async req => {
    sends.push({url:req.url, data: JSON.parse(req.data)});
    if (sends.at(-1).data.content.endsWith('sendfail')) {
      throw Object.assign(new Error('send failed'), {config: req, response: {
        data: JSON.stringify({code: 11292, message: 'permission denied (sensitive diagnostic text)'}),
        status: 403, headers: {'x-tps-trace-id': 'test-trace'}, config: req
      }});
    }
    return {data: {id:'sent'}, status:200, statusText:'OK', headers:{}, config:req};
  };
  const server = bot.receiver.handler.server;
  const listen = server.listen;
  t.mock.method(server, 'listen', function() { return listen.call(this, 0, '127.0.0.1'); });
  await bot.receiver.start(bot.sessionManager);
  t.after(() => bot.receiver.stop(bot.sessionManager));
  const key = createPrivateKey({format:'der', type:'pkcs8', key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'), Buffer.from(env.BOT_SECRET.repeat(4))])});
  const post = async (packet, valid = true) => {
    const body = JSON.stringify(packet);
    const signature = sign(null, Buffer.from('123'+(valid ? body : 'other')), key).toString('hex');
    return fetch('http://127.0.0.1:'+server.address().port+'/qq/callback', {method:'POST', body,
      headers:{'x-signature-timestamp':'123','x-signature-ed25519':signature},signal:AbortSignal.timeout(3000)});
  };
  const at = (id,content,extra={}) => ({op:0,t:'GROUP_AT_MESSAGE_CREATE',d:{id,group_openid:'A',
    author:{member_openid:'member'},content,...extra}});
  const challenge=await post({op:13,d:{plain_token:'check',event_ts:'123'}});
  const result=await challenge.json();
  assert.equal(result.plain_token,'check');
  assert.ok(verify(null,Buffer.from('123check'),createPublicKey(key),Buffer.from(result.signature,'hex')));
  assert.equal((await post(at('bad','bad'),false)).status,401);
  for(const packet of [
    {...at('normal','机器人昵称'),t:'GROUP_MESSAGE_CREATE'},
    {...at('other','<@!other> hi',{mentions:[{id:'other'}]}),t:'GROUP_MESSAGE_CREATE'},
    {...at('same','<@!self> slow',{mentions:[{id:'self'}]}),t:'GROUP_MESSAGE_CREATE'},
    {...at('dm','dm'),t:'C2C_MESSAGE_CREATE'},at('self','self',{author:{id:'self'}}),
    at('blank','<@!self>  ',{attachments:[{content_type:'image/jpeg'}]})]) {
    assert.equal((await post(packet)).status,200);
  }
  assert.equal(requests.length,0);
  assert.equal(sends.length,0);
  const observations = () => logs.filter(log => log.stage === 'qq_group_event_probe');
  const ordinary = observations().filter(log => log.event_type === 'GROUP_MESSAGE_CREATE');
  assert.deepEqual(ordinary.map(log => [log.has_mentions,log.mentions_self_by_id]), [
    [false,false], [true,false], [true,true]
  ]);
  assert.equal(observations().length,5);
  const first=at('same','<@!self> slow',{message_reference:{content:'history'},attachments:[{filename:'ignore'}]});
  assert.equal((await post(first)).status,200);
  await post(first);
  assert.equal(requests.length,1);
  assert.equal(sends.length,1);
  await post(at('same','second',{group_openid:'B',author:{member_openid:'another'}}));
  const events = observations().slice(-3);
  assert.match(ordinary[2].message_tag, /^[a-f0-9]{24}$/);
  assert.equal(events[0].message_tag, ordinary[2].message_tag);
  assert.equal(events[1].message_tag, events[0].message_tag);
  assert.notEqual(events[2].message_tag, events[0].message_tag);
  assert.ok(events[0].has_reference && events[0].has_attachments);
  assert.doesNotMatch(JSON.stringify(observations()), /机器人昵称|<@!|history|member_openid|slow/);
  slow.resolve();
  await nextTurn();
  const feedback = sends.filter(s => s.data.msg_seq === 1);
  assert.deepEqual(feedback.map(s => s.data.content), [
    '正在烧脑中，请稍后...',
    '正在烧脑中，请稍后...'
  ]);
  assert.deepEqual(sends.filter(s => s.data.msg_seq === 2).map(s=>[s.url,s.data.msg_id,s.data.content]),[
    ['/v2/groups/B/messages','same','<image> second'],['/v2/groups/A/messages','same','<image> slow']]);
  for(const q of ['timeout','empty','error','sendfail','next']) {
    await post(at(q,q)); await post(at(q,q));
  }
  await nextTurn();
  assert.equal(sends.length,14);
  assert.ok(sends.every(s => s.data.msg_type === 0));
  const {timestamp, ...apiError} = logs.find(log => log.stage === 'qq_reply_api_error');
  assert.ok(Number.isFinite(Date.parse(timestamp)));
  assert.deepEqual(apiError, {
    stage: 'qq_reply_api_error', http_status: 403, qq_code: 11292,
    trace_id: 'test-trace', hint: 'permission', sandbox: true
  });
  const requestId = logs.find(log => log.stage === 'group_at_received').request_id;
  const tracked = logs.filter(log => log.request_id === requestId);
  assert.deepEqual(tracked.map(log => log.stage), [
    'group_at_received', 'qq_reply_sending', 'qq_ack_sent', 'model_answered', 'qq_reply_sending', 'qq_reply_receipt_probe', 'qq_replied'
  ]);
  assert.equal(tracked.find(log => log.stage === 'qq_reply_receipt_probe').has_message_id, true);
  assert.deepEqual(tracked.filter(log => log.stage === 'qq_reply_sending').map(log => log.msg_seq), [1, 2]);
  assert.ok(tracked.filter(log => log.stage === 'qq_reply_sending').every(log => !log.has_mention_markup));
  assert.ok(sends.filter(s => s.data.msg_seq === 2).slice(2,5).every(s=>s.data.content==='暂时无法回答，请稍后重新 @ 我。'));
  const questions=['slow','second','timeout','empty','error','sendfail','next'];
  assert.deepEqual(requests,questions.map(content=>({model:env.LLM_MODEL,stream:false,messages:[{role:'user',content}]})));
});

test('DeepSeek deep search is opt-in and the provider runs it in a single request', async t => {
  assert.throws(() => readConfig({...env, LLM_WEB_SEARCH: 'yes'}), /LLM_WEB_SEARCH/);
  assert.throws(() => readConfig({...env, LLM_WEB_SEARCH: 'true'}), /DeepSeek/);
  assert.equal(readConfig(env).llm.webSearch, false);
  const settings = readConfig({...env, LLM_WEB_SEARCH: 'true', LLM_MODEL: 'deepseek-flash',
    LLM_CHAT_URL: 'https://api.deepseek.com/chat/completions'}).llm;
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  let requests = 0;
  const complete = createCompletion(settings, async (url, options) => {
    requests++;
    assert.equal(url, settings.url);
    assert.deepEqual(JSON.parse(options.body), {
      model: 'deepseek-flash', stream: false, messages: [{role: 'user', content: '最近更新了什么？'}],
      tools: [{type: 'deepseek_web_search'}], thinking: {type: 'enabled'}
    });
    return Response.json({choices: [{message: {content: '更新摘要', server_tool_calls: [
      {calls: [{type: 'deepseek_web_search', status: 'completed'}]}
    ]}}]});
  });
  assert.equal(await complete([{role: 'user', content: '最近更新了什么？'}]), '更新摘要');
  assert.equal(requests, 1);
  assert.deepEqual(logs, [{stage: 'llm_web_search_completed'}]);
});

test('DeepSeek enables link reading only for requests with a link in the current question', async () => {
  const settings = {
    ...config.llm, model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions', webSearch: true
  };
  const bodies = [];
  const request = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({choices: [{message: {content: '回答'}}]});
  };
  const complete = createCompletion(settings, request);
  const link = {role: 'user', content: '请总结这个网页：HTTPS://example.com/article。'};
  const question = {role: 'user', content: 'HTTP 和 HTTPS 有什么区别？'};
  await complete([link]);
  await complete([link, {role: 'assistant', content: '网页摘要'}, question]);
  await createCompletion({...settings, webSearch: false}, request)([link]);
  await createCompletion({...settings, url: config.llm.url, webSearch: false}, request)([link]);

  const search = {type: 'deepseek_web_search'};
  const readUrl = {type: 'deepseek_read_url'};
  assert.deepEqual(bodies.map(({tools, thinking}) => [tools, thinking?.type]), [
    [[search, readUrl], 'disabled'],
    [[search], 'enabled'],
    [[readUrl], 'disabled'],
    [undefined, undefined]
  ]);
  assert.deepEqual(bodies[0].messages, [link]);
});
