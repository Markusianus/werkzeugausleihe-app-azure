#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# GitHub sync guard
# Ensures the local repo is clean and in sync with origin before deploying.
# Prevents deploying stale or unpushed state to staging.
# ---------------------------------------------------------------------------
check_github_sync() {
  local repo_dir
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  if ! git -C "$repo_dir" rev-parse --is-inside-work-tree &>/dev/null; then
    echo "WARNING: Not a git repository — skipping GitHub sync check." >&2
    return
  fi

  echo "== Checking GitHub sync state =="

  # 1. Uncommitted changes?
  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    echo "ERROR: You have uncommitted changes. Commit or stash them before deploying." >&2
    git -C "$repo_dir" status --short >&2
    exit 1
  fi

  # 2. Untracked files?
  local untracked
  untracked="$(git -C "$repo_dir" ls-files --others --exclude-standard)"
  if [[ -n "$untracked" ]]; then
    echo "WARNING: Untracked files detected (not blocking, but consider committing):" >&2
    echo "$untracked" >&2
  fi

  # 3. Fetch latest remote state (non-destructive)
  local current_branch
  current_branch="$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD)"
  git -C "$repo_dir" fetch origin "$current_branch" --quiet 2>&1 || {
    echo "WARNING: Could not fetch from origin — skipping remote sync check." >&2
    return
  }

  local local_sha remote_sha
  local_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  remote_sha="$(git -C "$repo_dir" rev-parse "origin/$current_branch" 2>/dev/null || echo '')"

  if [[ -z "$remote_sha" ]]; then
    echo "WARNING: Branch '$current_branch' has no upstream on origin — skipping remote check." >&2
    return
  fi

  # 4. Local is behind remote → must pull first
  local behind
  behind="$(git -C "$repo_dir" rev-list --count HEAD..origin/"$current_branch")"
  if [[ "$behind" -gt 0 ]]; then
    echo "ERROR: Local branch '$current_branch' is $behind commit(s) behind origin. Pull first." >&2
    exit 1
  fi

  # 5. Local has unpushed commits → offer to push or abort
  local ahead
  ahead="$(git -C "$repo_dir" rev-list --count origin/"$current_branch"..HEAD)"
  if [[ "$ahead" -gt 0 ]]; then
    echo "WARNING: $ahead local commit(s) on '$current_branch' are not yet pushed to GitHub."
    printf "Push to origin/%s before deploying? [Y/n] " "$current_branch"
    read -r answer </dev/tty
    if [[ "${answer,,}" != "n" ]]; then
      echo "== Pushing $ahead commit(s) to origin/$current_branch =="
      git -C "$repo_dir" push origin "$current_branch"
    else
      echo "WARNING: Deploying without pushing — staging will be ahead of GitHub."
    fi
  fi

  echo "== GitHub sync OK (branch: $current_branch, sha: ${local_sha:0:8}) =="
}

check_github_sync

# ---------------------------------------------------------------------------

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

Default local source for these variables:
  .local/staging.env

Optional environment variables:
  LOCAL_ENV_FILE       (override path to env file; default: .local/staging.env)
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

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT_DIR/.local/staging.env}"

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-https://toolhub-backend-staging-ftf4eahwb7fkfshg.germanywestcentral-01.azurewebsites.net/api/health}"
FRONTEND_URL="${FRONTEND_URL:-https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/}"
FRONTEND_CONFIG_URL="${FRONTEND_CONFIG_URL:-https://toolhub-frontend-staging-c3b0e3ctc4g5b9f3.germanywestcentral-01.azurewebsites.net/config.js}"

load_local_env() {
  if [[ -f "$LOCAL_ENV_FILE" ]]; then
    echo "== Loading staging env from $LOCAL_ENV_FILE =="
    set -a
    # shellcheck disable=SC1090
    source "$LOCAL_ENV_FILE"
    set +a
  else
    echo "== No local staging env file found at $LOCAL_ENV_FILE (using current environment) =="
  fi
}

load_local_env

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
