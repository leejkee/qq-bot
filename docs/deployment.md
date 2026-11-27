# QQ-Bot 部署与运维操作手册

## 1. 适用范围

本文档适用于 QQ-Bot 的远程部署、版本更新、服务重启和运行状态排查。

所有操作必须遵守根目录 `AGENTS.md` 中规定的授权与安全约束。

## 2. SSH 连接

| 配置项 | 值 |
|---|---|
| SSH Host | `qq-bot` |
| 登录用户 | `deploy-agent` |
| 服务器系统 | Debian 12 |
| 应用目录 | `/opt/qq-bot/` |
| 运行时用户 | `qq-bot-runtime` |
| Systemd 服务 | `qq-bot.service` |

连接服务器：

```bash
ssh qq-bot
```

验证连接及身份：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 qq-bot "whoami"
```

预期输出：

```text
deploy-agent
```

SSH 连接信息由本地 SSH Config 管理。

如果连接失败，不得关闭 SSH 主机密钥验证、修改 SSH 服务配置或尝试其他用户身份，应向管理员报告。

## 3. 目录与权限

| 路径 | 管理者 | 用途 |
|---|---|---|
| /opt/qq-bot/ | deploy-agent | 源码、依赖和构建产物 |
| /etc/qq-bot/.env | root | systemd 读取的配置及密钥 |
| /var/lib/qq-bot/ | qq-bot-runtime | 预留数据目录 |
| /var/log/qq-bot/ | qq-bot-runtime | 预留文件日志目录，当前日志进入 journal |
| /etc/systemd/system/qq-bot.service | root | 服务配置 |

### 管理员首次初始化

1. 确认 deploy-agent 已存在，Debian 使用 systemd，`/usr/bin/node` 为 22 或以上版本，部署账号能使用 pnpm 10.25.0。
2. 在管理员控制的目录审核同一版本的 `deploy/install.sh` 和 `deploy/qq-bot.service`，再执行 `sudo bash deploy/install.sh`。脚本初始化运行用户、目录和权限，安装并启用服务。已有单元内容不同时脚本退出，交由管理员核对。
3. 管理员自行准备 root 持有、模式 0600 的 `/etc/qq-bot/.env`。保留业务变量，设置 `QQBOT_CONFIG_DIR=/etc/qq-bot`、`QQBOT_DATA_DIR=/var/lib/qq-bot`、`QQBOT_LOG_DIR=/var/log/qq-bot`。省略 NODE_ENV，由服务模板设置 production。Agent 不接触原配置或密钥。
4. 将项目检出到 /opt/qq-bot，确保 deploy-agent 可更新，运行用户可读取和遍历构建产物与依赖。首次切换前由管理员确认旧实例已退出，随后按以下流程构建并启动。

## 4. 部署前检查

连接服务器后执行：

```bash
cd /opt/qq-bot

whoami
git status --short
git branch --show-current
git rev-parse HEAD
node --version
pnpm --version

systemctl is-active qq-bot
```

检查以下事项：

- 当前登录用户是否正确。
- 当前工作目录是否正确。
- 当前 Git 分支是否符合部署目标。
- 是否存在未提交的服务器端修改。
- Node.js 和 pnpm 版本是否满足项目要求。
- 记录当前 Git Commit，作为回退依据。

如果服务器工作区存在未提交修改、分支异常或环境不符合要求，停止更新并报告。

## 5. 更新应用

默认采用 Git 拉取方式部署已提交的代码。

### 5.1 更新源码

确认目标分支为 main 后执行：

```bash
cd /opt/qq-bot

git fetch origin main
git pull --ff-only origin main
```

如果用户指定了其他版本，以用户授权的目标版本为准。

禁止使用 `git reset --hard`、`git clean -fd` 等破坏性命令强制处理冲突。

如采用文件上传方式部署，应仅上传明确指定的源码或构建产物，不得覆盖运行时数据、日志或生产配置。

### 5.2 安装依赖与构建

在项目目录逐项执行，任一命令失败即停止部署并保留诊断信息。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

## 6. 服务管理

在项目根目录使用脚本，仅执行管理员已授权的服务管理命令。

```bash
bash deploy/start.sh restart
bash deploy/start.sh status
bash deploy/start.sh logs
```

无参数默认执行 restart。systemd 会启动未运行的服务，或向当前实例发送 SIGTERM 后启动新版本。

### 6.1 重启服务

代码或构建产物更新后执行：

```bash
sudo -n systemctl restart qq-bot
```

`-n` 表示非交互模式。如果 sudo 需要密码或命令未被授权，应停止操作并报告。

### 6.2 重载配置

只有应用和 Systemd 服务明确支持 reload，且管理员已授权时，才可以执行：

```bash
sudo -n systemctl reload qq-bot
```

不得假设 reload 能够加载所有配置变更。

### 6.3 查看服务状态

优先使用非特权命令：

```bash
systemctl is-active qq-bot
systemctl status qq-bot --no-pager
```

禁止执行未授权的 start、stop、enable、disable、daemon-reload 或其他系统服务管理命令。

## 7. 日志排查

查看最近 100 条服务日志：

```bash
journalctl -u qq-bot -n 100 --no-pager
```

查看最近一小时的日志：

```bash
journalctl -u qq-bot --since "1 hour ago" --no-pager
```

应用日志目录：

```text
/opt/qq-bot/logs/
```

仅在具有合法读取权限时查看日志。

Agent 应优先使用有限范围的日志查询，避免无限期执行 `journalctl -f`。

日志中可能存在 QQ 消息、用户标识、Token 或其他敏感数据。向用户报告时应进行必要的脱敏。

禁止自行清理、截断或修改生产日志。

如果当前用户无法读取日志，应向管理员申请受限的日志读取权限。

## 8. 部署验收

完成更新并重启服务后执行：

```bash
cd /opt/qq-bot

git rev-parse HEAD
systemctl is-active qq-bot
systemctl status qq-bot --no-pager
journalctl -u qq-bot -n 100 --no-pager
```

确认以下事项：

- 服务处于 active 状态。
- 无持续重启或异常退出。
- 应用初始化正常。
- 无明显配置、网络连接或运行时错误。
- 如条件允许，验证 QQ-Bot 的实际消息响应功能。

仅有 active 状态不足以证明业务功能正常。

## 9. 故障处理

| 异常情况 | 处理方式 |
|---|---|
| SSH 连接失败 | 检查本地 SSH Config，报告认证或网络错误 |
| sudo 命令被拒绝 | 停止操作，报告命令及错误信息 |
| Git 更新冲突 | 保留工作区，报告冲突 |
| 依赖安装失败 | 停止部署，报告依赖错误 |
| 构建或测试失败 | 不重启服务，报告失败原因 |
| 服务启动失败 | 检查状态和日志，报告故障 |
| 日志读取失败 | 请求管理员授权 |
| 配置或系统权限不足 | 提交变更建议，由管理员执行 |

未经用户授权，不得通过修改系统配置、扩大权限、删除数据或强制回退代码处理故障。

## 10. 部署结果报告

每次部署完成后输出以下信息：

- 应用：QQ-Bot
- 部署前版本：
- 部署后版本：
- 依赖安装结果：
- 构建结果：
- 测试结果：
- 服务状态：
- 日志检查结果：
- 业务功能验证结果：
- 异常及待处理事项：
- 最终结果：成功 / 失败 / 部分完成

对于未执行或无法验证的项目，必须明确标注，不得推断为成功。