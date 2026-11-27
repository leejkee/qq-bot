#!/bin/bash
set -euo pipefail

fail() { echo "$*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail "请由管理员运行"
[[ -d /run/systemd/system ]] || fail "需要 systemd"
id deploy-agent >/dev/null || fail "缺少部署用户 deploy-agent"
/usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "需要 /usr/bin/node 22+"

unit="$(dirname -- "$0")/qq-bot.service"
target=/etc/systemd/system/qq-bot.service
[[ -f "$unit" ]] || fail "缺少服务模板"
if [[ -e "$target" || -L "$target" ]]; then
  cmp -s "$unit" "$target" || fail "已有服务配置不同，请管理员核对"
fi

runtime=qq-bot-runtime
if ! getent group "$runtime" >/dev/null; then groupadd --system "$runtime"; fi
if ! id "$runtime" >/dev/null 2>&1; then
  useradd --system --gid "$runtime" --no-create-home --shell /usr/sbin/nologin "$runtime"
fi
[[ $(id -gn "$runtime") == "$runtime" ]] || fail "运行用户的主组不匹配"

install -d -m 0755 -o deploy-agent -g "$(id -gn deploy-agent)" /opt/qq-bot
install -d -m 0700 -o root -g root /etc/qq-bot
install -d -m 0750 -o "$runtime" -g "$runtime" /var/lib/qq-bot /var/log/qq-bot
if [[ ! -e "$target" ]]; then install -m 0644 -o root -g root "$unit" "$target"; fi
systemctl daemon-reload
systemctl enable qq-bot.service
