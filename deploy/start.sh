#!/bin/sh
set -eu
case "${1:-restart}" in
  restart) exec sudo -n systemctl restart qq-bot ;;
  status) exec systemctl status qq-bot --no-pager ;;
  logs) exec journalctl -u qq-bot -n 100 --no-pager ;;
  *) echo "用法: bash deploy/start.sh [restart|status|logs]" >&2; exit 2 ;;
esac
