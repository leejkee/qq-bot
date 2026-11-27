# QQ-Bot 部署架构调整需求

## 1. 任务范围

本次任务仅修改项目源码、配置模板、部署脚本及相关文档，不执行实际服务器部署，不修改服务器现有环境。

服务器中已经存在一份位于原管理员用户目录下的 `.env` 文件，该文件由管理员自行处理和迁移。

禁止 Agent 读取、复制、移动、删除、修改或迁移该文件，也不需要检查其中的配置内容。

## 2. 目标部署目录

| 路径 | 用途 | 管理者 |
|---|---|---|
| `/opt/qq-bot/` | 源码、依赖、构建产物 | deploy-agent |
| `/etc/qq-bot/` | 生产环境配置 | root |
| `/etc/qq-bot/.env` | 生产环境变量及密钥 | root |
| `/var/lib/qq-bot/` | 持久化运行数据 | qq-bot-runtime |
| `/var/log/qq-bot/` | 应用日志 | qq-bot-runtime |
| `/etc/systemd/system/qq-bot.service` | Systemd 服务配置 | root |

以上为目标目录结构，仅作为代码设计和部署模板的依据。本次任务不负责在服务器上创建这些目录。

## 3. 配置加载逻辑

统一通过 `process.env` 获取应用配置。

增加以下路径配置：

```dotenv
QQBOT_CONFIG_DIR=/etc/qq-bot
QQBOT_DATA_DIR=/var/lib/qq-bot
QQBOT_LOG_DIR=/var/log/qq-bot
```

具体要求：

- 保留现有业务环境变量及其命名。
- 不在业务源码中硬编码生产环境绝对路径。
- 集中管理环境变量读取、默认值及合法性检查。
- 必要配置缺失或非法时，明确报告错误并终止启动。
- 不得在日志中输出密钥或完整环境变量。
- 仅修改 `.env.example`，不修改任何真实 `.env` 文件。

### 本地开发环境

继续使用项目目录下的 `.env`，通过 dotenv 加载。

路径默认值：

```dotenv
NODE_ENV=development
QQBOT_CONFIG_DIR=./config
QQBOT_DATA_DIR=./data
QQBOT_LOG_DIR=./logs
```

### 生产环境

由 systemd 注入环境变量：

```ini
Environment=NODE_ENV=production
EnvironmentFile=/etc/qq-bot/.env
```

应用通过 `process.env` 读取配置，不需要直接访问 `/etc/qq-bot/.env`。

生产环境不得自动回退至项目目录下的 `.env` 或本地开发路径。

## 4. 日志管理

修改日志管理模块，使日志文件存储位置由 `QQBOT_LOG_DIR` 决定。

要求：

- 支持通过 `LOG_LEVEL` 配置日志级别。
- 日志包含时间、级别及消息内容。
- 支持日志轮转及过期清理。
- 保留必要的 stdout 和 stderr 输出，供 journald 使用。
- 禁止记录 API Key、Token、App Secret 等敏感信息。
- 日志目录不可写时明确报告错误，不得回退至源码目录。
- 优先复用现有日志模块及依赖，避免重复实现。

如果当前应用没有持久化数据需求，不需要额外实现数据存储功能。

## 5. Systemd 服务模板

新增或修改 `deploy/qq-bot.service`。

参考配置：

```ini
[Unit]
Description=QQ Bot Service
Wants=network-online.target
After=network-online.target

[Service]
Type=simple

User=qq-bot-runtime
Group=qq-bot-runtime

WorkingDirectory=/opt/qq-bot
ExecStart=/usr/bin/node /opt/qq-bot/dist/index.js

Environment=NODE_ENV=production
EnvironmentFile=/etc/qq-bot/.env

Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

StateDirectory=qq-bot
StateDirectoryMode=0750

LogsDirectory=qq-bot
LogsDirectoryMode=0750

[Install]
WantedBy=multi-user.target
```

根据实际项目结构调整启动命令及构建产物路径。

应用应支持 SIGTERM 信号及正常资源释放。

本次仅提供服务模板，不安装、不启动、不重启实际 systemd 服务。

## 6. 安装脚本

提供 `deploy/install.sh`，供管理员后续审核并手动执行。

脚本应负责：

- 检查运行环境。
- 检查或创建运行时用户。
- 初始化必要目录及权限。
- 安装 systemd 服务文件。
- 重新加载 systemd 配置。
- 配置开机自启动。

限制：

- 不负责创建、迁移或修改生产环境 `.env`。
- 不覆盖现有配置。
- 不删除运行数据及日志。
- 不修改 SSH、sudoers 或部署用户权限。
- 不自动启动应用。
- 保证重复执行的幂等性。

本次任务只编写脚本，不执行脚本。

## 7. 文档更新

同步更新：

- `.env.example`：声明全部配置项及其用途。
- `README.md`：说明本地开发和生产环境配置方式。
- `docs/deployment.md`：说明目标部署目录、安装流程、服务管理及日志位置。

保留现有 `AGENTS.md` 中的安全约束及远程部署授权规则。

## 8. 明确禁止的操作

本次任务禁止：

- SSH 连接生产服务器。
- 修改服务器上的任何文件。
- 访问原管理员用户目录。
- 读取或修改任何真实 `.env` 文件。
- 迁移生产配置及密钥。
- 执行服务器初始化脚本。
- 修改系统用户及权限。
- 安装、启动或重启生产服务。

所有测试应在本地环境中完成，使用模拟配置或测试专用环境变量。

## 9. 交付要求

完成代码修改后，报告：

- 修改及新增的文件。
- 新增或调整的环境变量。
- 配置加载逻辑的变化。
- 日志模块的变化。
- 构建及测试结果。
- 后续需要管理员手动执行的服务器初始化操作。

保持原有 QQ-Bot 业务功能不变。

本次任务结束于代码修改及本地验证，不进入实际部署阶段。