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

测试在回环地址启动 SDK 的 Webhook 接收器，使用临时签名、模拟模型和模拟 QQ 发送接口。开发入口为 `pnpm dev`，编译后的启动入口为 `pnpm start`。两者从进程环境读取配置。

## 部署到 Debian VPS

手动 SSH 登录后，可以在项目根目录执行 `bash deploy/start.sh` 后台启动已构建的版本。更新代码后先重新构建。脚本优先使用 `/opt/node22/bin/node`，读取已有的 `.env.save`（可选），再用 `.env` 覆盖同名配置。关闭 SSH 后进程可继续运行。用 `tail -f .run/qqbot.log` 查看日志，看到 `qq_webhook_ready` 表示就绪。用 `kill <启动时显示的PID>` 停止。若已有 systemd 服务运行，脚本会提示并退出。

安装 [Node.js 22 的 Linux 发行包](https://nodejs.org/dist/latest-v22.x/)，按服务器 CPU 选择架构，将解压目录的 `bin` 加入 PATH。执行 `node --version` 确认主版本为 22。以下命令使用 Node 自带的 Corepack 按 package.json 选用 pnpm。在项目目录，以有 sudo 权限的管理员账号执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
id qqbot >/dev/null 2>&1 || sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin qqbot
sudo install -d -m 0755 /opt/qqbot
sudo cp -r dist package.json pnpm-lock.yaml /opt/qqbot/
(cd /opt/qqbot && sudo env PATH="$PATH" corepack pnpm install --prod --frozen-lockfile --ignore-scripts)
sudo install -d -m 0700 /etc/qqbot
sudo touch /etc/qqbot/qqbot.env
sudo chmod 600 /etc/qqbot/qqbot.env
sudoedit /etc/qqbot/qqbot.env
```

按 [.env.example](.env.example) 填写运行配置。BOT_APPID 和 BOT_SECRET 来自 QQ 开放平台；BOT_SANDBOX 填 true 或 false，与测试群或生产环境一致。LLM_CHAT_URL 填兼容 Chat Completions 的完整 HTTPS 地址，LLM_MODEL 填账户可用的模型 ID。环境文件由 root 持有，systemd 在启动时读取。更改模型名或密钥后重启服务。

```sh
sudo install -m 0644 deploy/qqbot.service /etc/systemd/system/qqbot.service
command -v node
```

单元默认使用 `/usr/bin/node`。若 Node 22 安装在其他位置，编辑单元的 ExecStart 使用其绝对路径，确保 qqbot 系统用户可以执行。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now qqbot
sudo systemctl status qqbot
sudo journalctl -u qqbot -n 50
```

启动成功会记录 `qq_webhook_ready`。缺项或配置格式错误会以 78 退出；修正后执行 `sudo systemctl restart qqbot`。业务日志含处理阶段、耗时及可用错误码。SDK 自带的群聊正文日志已关闭。

## DeepSeek 联网搜索

在运行配置中设置 `LLM_WEB_SEARCH=true`，使用 DeepSeek 官方 Chat Completions 地址和支持联网搜索的模型。官方示例使用 `LLM_CHAT_URL=https://api.deepseek.com/chat/completions` 与 `LLM_MODEL=deepseek-flash`。模型名仍由 `LLM_MODEL` 指定。配置生效需要重启机器人。

开启后，每条群 @ 依旧独立请求。DeepSeek 根据问题决定是否搜索，应用等待完整回复，超时上限为 45 秒。看到 `llm_web_search_completed` 表示 DeepSeek 报告完成了一次搜索；群中发送回答正文。设为 `false` 或省略该变量可继续使用普通问答，兼容其他模型供应商。

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
