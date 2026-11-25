# QQ 群机器人 · TypeScript 开发说明

实现同目录 QQBOT-PRD.md 的单轮问答。首版一个 Node.js 进程，无数据库。新闻服务可以完全离线。

## 技术与参考实现

使用 TypeScript、Node.js 22、pnpm。QQ 接入采用第三方 qq-official-bot；参考仓库锁文件解析为 1.2.3，首轮建议锁定该版本并提交本项目自己的 pnpm-lock.yaml。参考其启动、群消息监听及事件回复代码。仅注册群 @ 消息业务处理器。模型端使用 Node 原生 fetch，首版建议对接 DeepSeek 的 OpenAI 兼容 Chat Completions 接口，模型名由环境变量指定。

- [参考项目启动入口](https://github.com/isomoes/qq-bot/blob/main/src/index.ts)
- [参考项目事件处理](https://github.com/isomoes/qq-bot/blob/main/src/handlers.ts)
- [参考项目锁文件](https://github.com/isomoes/qq-bot/blob/main/pnpm-lock.yaml)

## 运行配置

| 环境变量 | 用途 |
|---|---|
| BOT_APPID、BOT_SECRET | QQ 开放平台的机器人凭据。 |
| BOT_SANDBOX | 按当前应用和测试群选择环境，明确解析 true / false。 |
| LLM_CHAT_URL | 完整的 HTTPS 聊天接口地址，配置示例 https://api.deepseek.com/chat/completions 。 |
| LLM_API_KEY、LLM_MODEL | 调用密钥及该账户可用的模型名。 |

发布不含密钥的 .env.example，服务器配置路径为 /etc/qqbot/qqbot.env。启动时检查必填项；日志记录失败阶段、状态码和耗时，省略密钥、群聊原文和模型回答。

## 服务器首次配置与 systemd

管理员通过 SSH 或 Workbench 一次性填写配置，服务每次启动从进程环境读取。发布包附上 .env.example 和 qqbot.service；部署说明给出创建专用系统用户 qqbot、安装 Node.js 22 及运行依赖、安装编译产物到 /opt/qqbot 的步骤。配置独立于代码发布目录。

首次部署使用下列命令打开配置文件。touch 保留已有内容；再次编辑仅修改需要的值。

```sh
sudo install -d -m 0700 /etc/qqbot
sudo touch /etc/qqbot/qqbot.env
sudo chmod 600 /etc/qqbot/qqbot.env
sudoedit /etc/qqbot/qqbot.env
```

填写下列键，将占位值换为自己的值。模型名填 DeepSeek 账户可用的模型 ID。配置文件由 root 持有；系统级 systemd 读取后传给服务进程。真实凭据不进入仓库、命令行参数或日志。

```dotenv
BOT_APPID=<QQ机器人AppID>
BOT_SECRET=<QQ机器人AppSecret>
BOT_SANDBOX=true
LLM_CHAT_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=<DeepSeek模型ID>
LLM_API_KEY=<DeepSeek平台创建的API密钥>
```

systemd 单元示意，安装到 /etc/systemd/system/qqbot.service。ExecStart 中 node 的绝对路径按实际安装位置填写。

```ini
[Unit]
Description=QQ group single-turn bot
After=network-online.target
Wants=network-online.target
ConditionPathExists=/etc/qqbot/qqbot.env

[Service]
User=qqbot
WorkingDirectory=/opt/qqbot
EnvironmentFile=/etc/qqbot/qqbot.env
ExecStart=/usr/bin/node /opt/qqbot/dist/index.js
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=78

[Install]
WantedBy=multi-user.target
```

填写完成并安装单元后执行 sudo systemctl daemon-reload 和 sudo systemctl enable --now qqbot。启动校验在监听端口前完成；缺项时只列缺失的键和配置路径，以 78 退出，等待管理员修复。服务启动全程无交互。模型名或密钥变更后执行 sudo systemctl restart qqbot。通过 systemctl status qqbot 及 sudo journalctl -u qqbot -n 50 查看结果。验收覆盖缺项、改正后启动、重启读取新配置。

## Webhook 部署与控制台设置

1. 准备公网可访问的 HTTPS 地址，例如 https://bot.example.com/qq/callback ，将示例域名替换为实际域名。先启动应用和 HTTPS 入口，再保存控制台配置。
2. 在“开发设置 → 事件订阅与回调”选 Webhook，填写完整回调地址。选“部分接收”，在“群事件”下只勾选 GROUP_AT_MESSAGE_CREATE（群内 @ 机器人）。以保存并通过平台校验作为切换完成的标志。
3. 保存时入口需完成平台的回调验证挑战。正常事件按腾讯规范使用原始请求数据和签名头验签，验签通过后才进入业务。用锁定版 SDK 联测这两步；若内置入口未覆盖普通事件验签，在事件分发前补齐。签名错误时拒绝请求，模型调用次数应为零。
4. 回调确认收件与 QQ 消息回复分开。合法事件完成筛选和去重登记后及时确认收件，异步调用模型，再通过 QQ 消息 API（SDK 的 e.reply）发回答。用慢模型测试确认回调不等待推理结束，重投同一事件不会重复提问。
5. 排查顺序：保存时校验失败，检查域名、证书、代理路径及挑战回签；保存成功但无事件，检查群事件勾选和测试群；有事件但无回答，再查验签、模型请求及 QQ 回复结果。

参考：[SDK Webhook 配置](https://zhinjs.github.io/qq-official-bot/config.html) · [腾讯回调签名规范](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/dev-prepare/interface-framework/sign.md)。

## 开发顺序

1. **QQ 入口。** 在 src/index.ts 按参考仓库创建 Bot，配置 appid、secret、sandbox、removeAt: true、GROUP_AND_C2C_EVENT，先注册处理器再启动。接收方式固定为 Webhook：在 Bot 配置中显式指定 mode: ReceiverMode.WEBHOOK、port: 3000、path: "/qq/callback"。VPS 的 HTTPS 反向代理将该路径转到本机 SDK 监听端口，保留请求头和原始请求体。
2. **群 @ 筛选。** 只把平台 GROUP_AT_MESSAGE_CREATE 对应的 SDK 群事件交给业务。检查锁定版 SDK 的事件映射；若同一 message.group 监听器包含多种来源，应在保留原始事件类型的入口筛选。removeAt 仅清理文字，不能证明发生了 @。不得用昵称匹配判断触发。忽略自身事件，不注册私聊处理器。只取本条消息的文本段，排除提及标记、附件占位和引用正文，trim 后为空直接结束。
3. **独立模型请求。** 在 src/llm.ts 实现 answer(question): Promise<string>。每次重新构造请求体，固定 model，messages 只有一项：role 为 user，content 为当前问题。使用 Bearer 凭据和 application/json。只取 choices[0].message.content 中的非空文本，整段返回；关闭流式输出，不传历史、用户 ID 或工具。使用 AbortSignal.timeout，建议默认 20 秒；单次失败交由处理器提示，不自动重试。
4. **回复与去重。** 在首个 await 前按群 ID 和平台消息 ID 登记短时内存去重键（建议 10 分钟，到期释放），仅存标识。把 answer 的结果通过当前事件的 e.reply(text) 回复一次。模型失败时尝试一次固定短提示；如果发送动作本身失败，只记录错误，不重新调用模型或重复发送。每个事件独立捕获异常，避免一个失败结束进程。内存去重范围限于同一进程生命周期。
5. **构建入口。** 提供 pnpm dev、pnpm typecheck、pnpm test、pnpm build、pnpm start。建议开发用 tsx，生产用 tsc 编译后 node dist/index.js。管理员完成 QQ 配置并按上述步骤启动 systemd 服务后即可在测试群验证；运行前确保仅一个实例使用该机器人凭据。

## 验收与定位

用可注入的假模型和回复函数运行 node:test，测试无需真实 QQ 凭据。分别模拟群 @、普通群消息、@ 他人、私聊、空消息、重复事件。断言模型与回复次数符合 PRD。并发投递不同群或成员的两个问题，核对两份请求体各只有自己的文字，回答各发回原事件。分别模拟模型超时和 QQ 发送失败，断言每个提问最多发起一次模型请求及一次回复尝试。

今晚先用真实账号发一条群 @ 提问，再做连续提问和普通消息静默测试。若未回复，按“收到目标事件 → 模型返回文本 → QQ 接受回复”查看日志；开发阶段可注入固定模型答复单独测 QQ 链路，无需添加任何群命令。
