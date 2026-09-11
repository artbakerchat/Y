#!/usr/bin/env bash
# Run as root from an EC2 checkout: bash ai/ec2/bootstrap.sh ID REGION BUCKET SECRET_ARN
set -euo pipefail
[[ $# == 4 ]] || { echo "Usage: $0 ID REGION SESSION_BUCKET SECRET_ARN" >&2; exit 2; }
[[ $EUID == 0 ]] || { echo "Run with sudo on the target EC2 host." >&2; exit 2; }
agent_id=$1
agent_region=$2
agent_bucket=$3
agent_secret=$4
case "$agent_id:$agent_region" in
  agy:us-west-2|kiro:ca-central-1|codex:eu-west-3) ;;
  *) echo "Unknown agent/region pair." >&2; exit 2 ;;
esac
[[ $agent_bucket =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || exit 2
[[ $agent_secret =~ ^arn:aws:secretsmanager:$agent_region:[0-9]{12}:secret:[a-zA-Z0-9/_+=.@-]+$ ]] || exit 2
repo_dir=$(git rev-parse --show-toplevel)
[[ $repo_dir == /opt/larboard/repo ]] || {
  echo "Install a dedicated checkout at /opt/larboard/repo first." >&2; exit 2;
}
# Never silently repurpose an already configured host as a different peer.
if [[ -f /etc/larboard/agent.env ]]; then
  rg_command="AGENT_ID=$agent_id"
  grep -qxF "$rg_command" /etc/larboard/agent.env || {
    echo "Host already belongs to a different agent." >&2; exit 2;
  }
fi
if command -v dnf >/dev/null; then
  dnf install -y python3.12 git
elif command -v apt-get >/dev/null; then
  apt-get update
  apt-get install -y python3-venv git
fi
agent_python=$(command -v python3.12 || command -v python3)
"$agent_python" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'
id larboard >/dev/null 2>&1 || useradd --system --home-dir /var/lib/larboard --create-home --shell /usr/sbin/nologin larboard
install -d -m 0755 /etc/larboard /var/lib/larboard
"$agent_python" -m venv /opt/larboard/venv
/opt/larboard/venv/bin/pip install -r "$repo_dir/ai/requirements.txt"
git config user.name "Larboard $agent_id"
git config user.email "$agent_id@users.noreply.github.com"
# Local repository tools run under the service identity.
git config --system --add safe.directory /opt/larboard/repo
umask 077
printf 'AGENT_ID=%s\nAWS_REGION=%s\nAWS_DEFAULT_REGION=%s\nAGENT_SESSION_BUCKET=%s\nAGENT_SECRET_ARN=%s\nAGENT_REPO_DIR=%s\n' \
  "$agent_id" "$agent_region" "$agent_region" "$agent_bucket" "$agent_secret" "$repo_dir" > /etc/larboard/agent.env
install -m 0644 "$repo_dir/ai/ec2/larboard-agent.service" /etc/systemd/system/larboard-agent.service
systemctl daemon-reload
systemctl enable larboard-agent.service
systemctl restart larboard-agent.service
# Success means the process loaded the secret and can answer locally.
for attempt in $(seq 1 30); do
  if /opt/larboard/venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=2)' 2>/dev/null; then
    echo "$agent_id service is healthy on localhost:8080"
    exit 0
  fi
  sleep 2
done
echo "Service did not become healthy. Inspect journalctl -u larboard-agent." >&2
exit 1
