#!/bin/sh
# Starts the apply-kit service at login with a launchd LaunchAgent (docs/ARCHITECTURE.md).
#
#   pnpm service:install     build the UI, write ~/Library/LaunchAgents/dev.krisiliev.apply-kit.plist, start it
#   pnpm service:uninstall   stop it and remove the plist
#   pnpm service:status      what launchd knows about it
#   sh scripts/launchagent.sh print   show the plist install would write, change nothing
#
# Run install from a shell where `node` is Node 22 (nvm use). Its absolute path goes into the
# plist, so after upgrading Node run install again. Settings stay in .env, never in the plist.
set -eu

label="dev.krisiliev.apply-kit"
repo="$(cd "$(dirname "$0")/.." && pwd)"
template="$repo/scripts/launchagent/$label.plist.template"
plist="$HOME/Library/LaunchAgents/$label.plist"
logs="$HOME/Library/Logs/apply-kit"
domain="gui/$(id -u)"

render() {
  node_bin="$(command -v node || true)"
  if [ -z "$node_bin" ]; then echo "node not found on PATH; run 'nvm use' first." >&2; exit 1; fi
  if ! "$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
    echo "Node $("$node_bin" --version) at $node_bin is too old; apply-kit needs Node 22.13 or newer." >&2; exit 1
  fi
  sed -e "s|__NODE__|$node_bin|g" -e "s|__REPO__|$repo|g" -e "s|__HOME__|$HOME|g" "$template"
}

case "${1:-}" in
  print)
    render
    ;;
  install)
    (cd "$repo" && pnpm --filter @apply-kit/app build)
    mkdir -p "$logs" "$(dirname "$plist")"
    tmp="$(mktemp)"
    render > "$tmp"
    plutil -lint "$tmp" >/dev/null
    launchctl bootout "$domain/$label" 2>/dev/null || true
    mv "$tmp" "$plist"
    launchctl bootstrap "$domain" "$plist"
    echo "Installed: the service starts at login and is running now. Logs: $logs"
    ;;
  uninstall)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "Removed: the service no longer starts at login."
    ;;
  status)
    launchctl print "$domain/$label" 2>/dev/null | grep -E '^\s*(state|pid|last exit code|program) ' || echo "Not installed."
    ;;
  *)
    echo "Usage: $0 install|uninstall|status|print" >&2
    exit 2
    ;;
esac
