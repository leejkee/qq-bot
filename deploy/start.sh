#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."

if systemctl --user is-active --quiet qqbot.service 2>/dev/null ||
   systemctl is-active --quiet qqbot.service 2>/dev/null; then
  echo "qqbot.service 已在运行。"
  exit 0
fi

if [[ -x /opt/node22/bin/node ]]; then
  export PATH="/opt/node22/bin:$PATH"
fi
if [[ ! -f dist/index.js ]]; then
  echo "缺少 dist/index.js，请先在项目根目录运行 pnpm build。" >&2
  exit 1
fi
if [[ ! -r .env ]]; then
  echo "请先在项目根目录配置 .env。" >&2
  exit 1
fi
env_files=()
[[ ! -r .env.save ]] || env_files+=(--env-file=.env.save)
env_files+=(--env-file=.env)

mkdir -p .run
exec 9>".run/qqbot.lock"
if ! flock -n 9; then
  echo "后台机器人已在运行。"
  exit 0
fi
# Node inherits the locked descriptor. The kernel releases it on exit.
nohup node "${env_files[@]}" dist/index.js </dev/null >>.run/qqbot.log 2>&1 &
pid=$!
exec 9>&-
sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  echo "启动失败，请查看 $PWD/.run/qqbot.log。" >&2
  exit 1
fi
echo "后台进程 PID=$pid，日志位于 $PWD/.run/qqbot.log。"
