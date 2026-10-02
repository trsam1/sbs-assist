#!/usr/bin/env bash
# Post-deploy smoke test. Read-only: never invokes Bedrock and never writes data.
# Usage: bash scripts/ci/smoke-test.sh <SITE_URL> <API_URL>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <SITE_URL> <API_URL>" >&2
  exit 2
fi

SITE="${1%/}"
API="${2%/}"
TRIES=10
DELAY=15
LAST=""

# retry <name> <url> <command...>: runs the check until it passes (new DNS/certs can lag).
retry() {
  local name="$1" url="$2"
  shift 2
  for ((i = 1; i <= TRIES; i++)); do
    if LAST=$("$@" 2>&1); then
      echo "✅ ${name}"
      return 0
    fi
    echo "… ${name} failed (attempt ${i}/${TRIES}), retrying in ${DELAY}s"
    sleep "$DELAY"
  done
  echo "❌ ${name} failed: ${url}" >&2
  echo "Last response:" >&2
  echo "${LAST}" | head -c 2000 >&2
  echo >&2
  exit 1
}

check_config_json() {
  local body
  body=$(curl -fsS "${SITE}/config.json")
  echo "$body"
  jq -e --arg api "$API" '
    (.apiUrl | type == "string") and (.cognitoUserPoolId | type == "string")
    and (.cognitoUserPoolClientId | type == "string") and (.cognitoRegion | type == "string")
    and ((.apiUrl | sub("/+$"; "")) == $api)' <<<"$body" >/dev/null
}

check_config_cache() {
  local headers
  headers=$(curl -fsSI "${SITE}/config.json")
  echo "$headers"
  grep -qi '^cache-control:.*no-cache' <<<"$headers"
}

check_studies_requires_auth() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${API}/studies")
  echo "HTTP ${code}"
  [[ "$code" == "401" ]]
}

check_strongs_lookup() {
  local body
  body=$(curl -fsS "${API}/strongs/G25")
  echo "$body"
  # type == "string" also catches a seed that stored typed DynamoDB JSON ({"S": …}).
  jq -e '.definition | type == "string" and length > 0 and . != "Definition not available"' <<<"$body" >/dev/null
}

check_index_html() {
  local body
  body=$(curl -fsS "${SITE}/")
  echo "$body" | head -c 500
  grep -q '<app-root' <<<"$body"
}

retry "config.json has the 4 keys and matches the API URL" "${SITE}/config.json" check_config_json
retry "config.json is served no-cache" "${SITE}/config.json" check_config_cache
retry "GET /studies without a token returns 401" "${API}/studies" check_studies_requires_auth
retry "Strong's G25 lookup returns a definition" "${API}/strongs/G25" check_strongs_lookup
retry "index.html contains <app-root" "${SITE}/" check_index_html
echo "Smoke test passed for ${SITE}"
