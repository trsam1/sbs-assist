#!/usr/bin/env bash
# Posts (or updates in place) the single cdk-diff comment on a PR.
# Usage: bash scripts/ci/pr-comment.sh <PR_NUMBER>   (needs GH_TOKEN, GITHUB_REPOSITORY, GITHUB_WORKSPACE)
set -euo pipefail

PR="${1:?Usage: $0 <PR_NUMBER>}"
[[ "$PR" =~ ^[0-9]+$ ]] || { echo "PR number must be numeric: $PR" >&2; exit 2; }
: "${GITHUB_REPOSITORY:?}" "${GITHUB_WORKSPACE:?}"

MARKER='<!-- cdk-diff-comment -->'
MAX_DIFF_CHARS=60000
GUARD_FILE="${GITHUB_WORKSPACE}/guard.txt"
DIFF_FILE="${GITHUB_WORKSPACE}/cdk-diff.txt"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

{
  echo "$MARKER"
  echo "## CDK diff"
  echo
  echo "### Stateful-resource guard (prod)"
  echo
  if [[ -f "$GUARD_FILE" ]]; then cat "$GUARD_FILE"; else echo "guard not run"; fi
  echo
  echo "<details><summary>cdk diff (WordStudyToolStack, WordStudyTool-Dev, PipelineBootstrapStack)</summary>"
  echo
  echo '```'
  if [[ -f "$DIFF_FILE" ]]; then
    head -c "$MAX_DIFF_CHARS" "$DIFF_FILE"
    if (($(wc -c <"$DIFF_FILE") > MAX_DIFF_CHARS)); then
      echo
      echo "… truncated, see job log"
    fi
  else
    echo "diff not available"
  fi
  echo '```'
  echo
  echo "</details>"
} >"$BODY_FILE"

existing_id=$(
  gh api --paginate "repos/${GITHUB_REPOSITORY}/issues/${PR}/comments" \
    --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"${MARKER}\"))) | .id" |
    sed -n 1p # reads all input (unlike head), so pipefail never sees SIGPIPE
)

if [[ -n "$existing_id" ]]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing_id}" -F "body=@${BODY_FILE}" >/dev/null
  echo "Updated comment ${existing_id}"
else
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR}/comments" -F "body=@${BODY_FILE}" >/dev/null
  echo "Posted new comment"
fi
