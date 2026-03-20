#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy-staging.sh backend|frontend|all

Purpose:
  Deploy ToolHub staging apps to Azure App Service via direct Git push.
  This is the supported dev/staging deploy path.

Required environment variables:
  AZURE_STAGING_BACKEND_GIT_URL
  AZURE_STAGING_BACKEND_GIT_USERNAME
  AZURE_STAGING_BACKEND_GIT_PASSWORD
  AZURE_STAGING_FRONTEND_GIT_URL
  AZURE_STAGING_FRONTEND_GIT_USERNAME
  AZURE_STAGING_FRONTEND_GIT_PASSWORD

Optional environment variables:
  BACKEND_HEALTH_URL   (default: https://toolhub-backend-staging-ftf4eahwb7fkfshg.germanywestcentral-01.azurewebsites.net/api/health)
  FRONTEND_URL         (default: https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/)
  FRONTEND_CONFIG_URL  (default: https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/config.js)

Examples:
  scripts/deploy-staging.sh frontend
  scripts/deploy-staging.sh backend
  scripts/deploy-staging.sh all
EOF
}

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-https://toolhub-backend-staging-ftf4eahwb7fkfshg.germanywestcentral-01.azurewebsites.net/api/health}"
FRONTEND_URL="${FRONTEND_URL:-https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/}"
FRONTEND_CONFIG_URL="${FRONTEND_CONFIG_URL:-https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/config.js}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

prepare_git_url() {
  local base_url="$1"
  local user="$2"
  local pass="$3"
  node - <<'NODE' "$base_url" "$user" "$pass"
const [baseUrl, user, pass] = process.argv.slice(2);
const u = new URL(baseUrl);
u.username = user;
u.password = pass;
console.log(u.toString());
NODE
}

deploy_dir() {
  local source_dir="$1"
  local remote_url="$2"
  local label="$3"
  local deploy_dir="$WORK_DIR/$label"

  mkdir -p "$deploy_dir"
  cp -R "$source_dir/." "$deploy_dir/"
  rm -rf "$deploy_dir/.git" "$deploy_dir/node_modules"

  pushd "$deploy_dir" >/dev/null
  git init -q
  git config user.name "Nynx"
  git config user.email "nynx@local.invalid"
  git add .
  git commit -q -m "Deploy $label staging"
  git remote add azure "$remote_url"
  echo "== Pushing $label to Azure Staging =="
  git push azure master --force
  popd >/dev/null
}

healthcheck() {
  local url="$1"
  echo "== Checking $url =="
  curl -fsS -i --max-time 30 "$url"
}

deploy_backend() {
  require_var AZURE_STAGING_BACKEND_GIT_URL
  require_var AZURE_STAGING_BACKEND_GIT_USERNAME
  require_var AZURE_STAGING_BACKEND_GIT_PASSWORD
  local back_remote
  back_remote="$(prepare_git_url "$AZURE_STAGING_BACKEND_GIT_URL" "$AZURE_STAGING_BACKEND_GIT_USERNAME" "$AZURE_STAGING_BACKEND_GIT_PASSWORD")"
  deploy_dir "$ROOT_DIR/backend" "$back_remote" backend
  sleep 15
  healthcheck "$BACKEND_HEALTH_URL"
}

deploy_frontend() {
  require_var AZURE_STAGING_FRONTEND_GIT_URL
  require_var AZURE_STAGING_FRONTEND_GIT_USERNAME
  require_var AZURE_STAGING_FRONTEND_GIT_PASSWORD
  local front_remote
  front_remote="$(prepare_git_url "$AZURE_STAGING_FRONTEND_GIT_URL" "$AZURE_STAGING_FRONTEND_GIT_USERNAME" "$AZURE_STAGING_FRONTEND_GIT_PASSWORD")"
  deploy_dir "$ROOT_DIR/frontend" "$front_remote" frontend
  sleep 15
  healthcheck "$FRONTEND_URL"
  healthcheck "$FRONTEND_CONFIG_URL"
}

case "$TARGET" in
  backend)
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  all)
    deploy_backend
    deploy_frontend
    ;;
  *)
    usage
    exit 1
    ;;
esac
