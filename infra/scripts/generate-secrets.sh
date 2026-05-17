#!/usr/bin/env bash
# generate-secrets.sh
#
# Generates strong secrets for the backend and writes them into
# .env.dev and .env.prod, using .env.example as the template.
#
# Produces:
#   .env.dev, .env.prod              (mode 0600)
#   keys/dev/jwt.key, jwt.pub        (private 0600, public 0644)  RS256 keypair
#   keys/prod/jwt.key, jwt.pub       (private 0600, public 0644)  RS256 keypair
#
# Generated secrets:
#   APP_SECRET            — 64-byte base64 random  (OWASP A02)
#   JWT keypair           — 4096-bit RSA (RS256)   (OWASP A02, A07)
#   PHOTO_ENCRYPTION_KEY  — 32-byte base64 random  (AES-256-GCM, OWASP A02)
#   HA_WEBHOOK_SECRET     — 32-byte hex random     (HMAC, OWASP A08)
#
# Safety properties:
#   - Refuses to overwrite an existing .env.<env> unless --force is given.
#   - Never prints generated secrets to stdout (OWASP A09).
#   - umask 077 + explicit chmod ensure restrictive file modes.
#   - Refuses to run if openssl is unavailable.
#
# Usage:
#   ./infra/scripts/generate-secrets.sh           # generate both envs (skip if exist)
#   ./infra/scripts/generate-secrets.sh --force   # overwrite existing files

set -euo pipefail
umask 077

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Try --help" >&2
      exit 2
      ;;
  esac
done

# Resolve repo root (this script lives at infra/scripts/).
SCRIPT_DIR="$( cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"
cd "${REPO_ROOT}"

if [ ! -f .env.example ]; then
  echo "ERROR: .env.example not found at ${REPO_ROOT}" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required but not installed" >&2
  exit 1
fi

if ! command -v awk >/dev/null 2>&1; then
  echo "ERROR: awk is required but not installed" >&2
  exit 1
fi

# Replace a single KEY=... line in a .env file. Uses awk with FS="=" so we
# compare the literal first field — no regex escaping needed even when the
# value contains / + = (base64) or other shell metacharacters.
subst() {
  local file="$1" key="$2" value="$3"
  awk -v k="${key}" -v v="${value}" '
    BEGIN { FS = "="; OFS = "=" }
    {
      if (index($0, k "=") == 1) {
        print k "=" v
      } else {
        print
      }
    }
  ' "${file}" > "${file}.tmp"
  mv "${file}.tmp" "${file}"
}

generate_env() {
  local env="$1"            # "dev" or "prod"
  local node_env="$2"       # NODE_ENV value
  local db_path="$3"
  local log_level="$4"

  local env_file=".env.${env}"
  local keys_dir="keys/${env}"

  if [ -f "${env_file}" ] && [ "${FORCE}" -eq 0 ]; then
    echo "SKIP: ${env_file} already exists (use --force to overwrite)" >&2
    return 0
  fi

  mkdir -p "${keys_dir}"
  chmod 700 "${keys_dir}"

  local priv="${keys_dir}/jwt.key"
  local pub="${keys_dir}/jwt.pub"
  # RS256 keypair — 4096-bit RSA (OWASP A07: asymmetric JWT signing).
  openssl genrsa -out "${priv}" 4096 >/dev/null 2>&1
  openssl rsa -in "${priv}" -pubout -out "${pub}" >/dev/null 2>&1
  chmod 600 "${priv}"
  chmod 644 "${pub}"

  # Symmetric secrets. tr -d '\n' strips trailing newline from openssl rand.
  local app_secret photo_key webhook_secret
  app_secret="$(openssl rand -base64 64 | tr -d '\n')"
  photo_key="$(openssl rand -base64 32 | tr -d '\n')"
  webhook_secret="$(openssl rand -hex 32)"

  cp .env.example "${env_file}"
  chmod 600 "${env_file}"

  subst "${env_file}" NODE_ENV              "${node_env}"
  subst "${env_file}" APP_SECRET            "${app_secret}"
  subst "${env_file}" JWT_PRIVATE_KEY_PATH  "./${priv}"
  subst "${env_file}" JWT_PUBLIC_KEY_PATH   "./${pub}"
  subst "${env_file}" PHOTO_ENCRYPTION_KEY  "${photo_key}"
  subst "${env_file}" HA_WEBHOOK_SECRET     "${webhook_secret}"
  subst "${env_file}" DB_PATH               "${db_path}"
  subst "${env_file}" LOG_LEVEL             "${log_level}"

  # Clear the local copies of secrets — defence in depth (OWASP A09).
  app_secret=""
  photo_key=""
  webhook_secret=""

  echo "OK: wrote ${env_file} (0600), ${priv} (0600), ${pub} (0644)"
  echo "    NODE_ENV=${node_env}, LOG_LEVEL=${log_level}, DB_PATH=${db_path}"
}

generate_env "dev"  "development" "./data/app-dev.db" "debug"
generate_env "prod" "production"  "./data/app.db"     "info"

cat <<'NOTE'

Done.

Generated values are in .env.dev / .env.prod (mode 0600). They are .gitignored —
do not commit them. Still empty and must be filled in manually:

  ANTHROPIC_API_KEY     — separate keys for dev and prod, with spending limits
  HA_BASE_URL           — Home Assistant URL (e.g. http://homeassistant.local:8123)
  HA_TOKEN              — HA long-lived access token (separate per env)
  SUPABASE_URL          — only if cloud sync is enabled
  SUPABASE_ANON_KEY     — only if cloud sync is enabled
  SUPABASE_SERVICE_KEY  — only if cloud sync is enabled, backend only

To rotate any of the generated values, delete the corresponding entry from the
.env file (or the keypair from keys/<env>/) and re-run with --force.
NOTE
