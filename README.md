# QQ 群单轮问答机器人

群成员用 QQ 客户端真正 @ 机器人并输入文字，机器人调用一次模型，把纯文本答案回复到原群的原消息。每条请求只携带当前问题。同群、同消息 ID 在一个进程内去重 10 分钟，重启后清空。模型失败会回复一次简短提示，QQ 发送失败只记录阶段。服务独立运行，无需启动 newsbrief。

## 本地构建

安装 Node.js 22 和 pnpm 10.25.0，在本项目目录执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

本地将 `.env.example` 复制为 `.env`，填入开发用凭据，再运行 `pnpm dev`。开发启动使用 Node.js 内置 dotenv 加载项目目录的配置，已有进程环境变量优先。测试通过模拟配置和回环 Webhook 运行。

## 部署到 Debian VPS

生产由 systemd 从 `/etc/qq-bot/.env` 注入配置，以 `qq-bot-runtime` 运行。部署用户在 `/opt/qq-bot` 安装依赖并构建。管理员完成首次初始化后，在项目目录执行 `bash deploy/start.sh` 即可启动或重启已构建版本。

用 `bash deploy/start.sh status` 查看服务状态，用 `bash deploy/start.sh logs` 查看近期 journal。启动就绪事件为 `qq_webhook_ready`。按 `request_id` 跟踪群消息处理。发送诊断包括消息序号、长度、换行和 @ 标记，API 失败时记录 HTTP 状态、QQ 错误码及追踪 ID。

[部署与验收步骤](docs/deployment.md)

## DeepSeek 联网搜索

在运行配置中设置 `LLM_WEB_SEARCH=true`，使用 DeepSeek 官方 Chat Completions 地址和支持联网搜索的模型。官方示例使用 `LLM_CHAT_URL=https://api.deepseek.com/chat/completions` 与 `LLM_MODEL=deepseek-flash`。模型名仍由 `LLM_MODEL` 指定。配置生效需要重启机器人。

开启后，每条群 @ 依旧独立请求。DeepSeek 根据问题决定是否搜索，应用等待完整回复。普通问答和联网搜索的模型请求超时均为 60 秒。看到 `llm_web_search_completed` 表示 DeepSeek 报告完成了一次搜索；群中发送回答正文。设为 `false` 或省略该变量可继续使用普通问答，兼容其他模型供应商。

[DeepSeek Web Tools 文档](https://api-docs.deepseek.com/guides/web_tools/)

## 接入 QQ 开放平台

1. 准备域名和有效 TLS 证书。将公网 HTTPS 入口反向代理到本机 3000 端口。SDK 1.2.3 的监听地址覆盖所有网卡，服务器防火墙或安全组需将 3000 端口限制在本机。一个机器人凭据运行一个实例。
2. 例如在该域名的 Nginx HTTPS server 块中加入以下配置，保留原始请求体和签名头，然后检查并重载 Nginx。

   ```nginx
   location = /qq/callback {
       client_max_body_size 1m;
       limit_except POST { deny all; }
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
   }
   ```

3. 打开 QQ 开放平台「开发设置 → 事件订阅与回调」，选择 Webhook、部分接收，只勾选群内 @ 机器人事件 GROUP_AT_MESSAGE_CREATE，保存 `https://你的域名/qq/callback`。SDK 校验签名并处理平台挑战。
4. 在测试群先发普通文字，再用客户端的 @ 功能选中机器人，问“用一句话解释 PWM”。普通文字应静默，提问应在原群得到一次回复。再由两人连续提问，核对各自消息的回复。

保存回调失败时先查证书、路径和签名头；保存成功但机器人静默时，查订阅项、沙箱测试成员和日志。正常业务日志顺序为 `group_at_received`、`model_answered`、`qq_replied`。本地模拟验证和平台真实联调分别进行。

[产品需求](QQBOT-PRD.md) · [开发与验收说明](QQBOT-DEV.md)
