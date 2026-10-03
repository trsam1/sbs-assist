#!/usr/bin/env bash
# Idempotent agent-intake label bootstrap. Run from the repo root; needs an authenticated gh.
# `gh label create --force` creates each label or updates it in place, so re-runs are safe.
# Usage: bash scripts/agent-labels.sh
set -euo pipefail

gh label create --force agent-ready --color 0e8a16 --description 'Queued for an agent'
gh label create --force agent-in-progress --color fbca04 --description 'An agent is working this'
gh label create --force agent-pr-open --color 1d76db --description 'Agent opened a PR'
gh label create --force agent-blocked --color d93f0b --description 'Agent needs a human answer; see issue comment'
gh label create --force needs-human --color b60205 --description 'Out of agent scope; needs a human'
gh label create --force bug --color ee0701 --description 'Something is broken'
