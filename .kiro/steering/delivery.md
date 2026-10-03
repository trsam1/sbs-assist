---
inclusion: always
---

# Delivery

## Flow (trunk-based)

`feat/*`, `fix/*`, `agent/*` branch → PR to `main` → CI (`verify`, then read-only `cdk diff` + stateful guard posted as one PR comment) → merge → `deploy.yml` deploys dev, seeds it, smoke-tests it → prod waits for the user's approval on the `prod` environment → prod deploy + smoke test.

## Rules for AI agents

- Run `npm run verify` before pushing. It must pass.
- Never push to `main`. Work on a branch and open a PR.
- Never hold or request AWS credentials. CI is the only thing that touches AWS.
- Never rename construct IDs or physical names of stateful resources (tables, user pool, records), and never edit prod values in `infra/lib/stage-config.ts`, without an explicit user request.
- Never invoke Bedrock (or any AWS endpoint) from tests. Mock the SDK; `infra/test/setup-no-aws.ts` points unmocked calls at a dead endpoint.
- PR descriptions have three parts: summary, tests run, risks.
- New un-hashed files in `public/` must be added to both `DeployShell` `include` and `DeployAssets` `exclude` in `word-study-tool-stack.ts`, or they get the wrong cache headers.
- New CDK context lookups (e.g. another `fromLookup`) must be run locally and the updated `infra/cdk.context.json` committed. Neither CI role can assume the CDK lookup role, so a missing context entry fails CI.
- `PipelineBootstrapStack` changes are applied only by the user, locally: `npm run build && cd infra && npx cdk deploy PipelineBootstrapStack`. CI never deploys it.

## Reading the PR diff comment

- Guard section: `✅ No stateful-resource replacement or deletion` is required. A violations table means a table or user pool would be deleted, replaced, orphaned, or is not `Retain`; the `diff` job fails and the PR must not merge.
- Diff section: `[+]` add, `[~]` modify, `[-]` remove. For `WordStudyToolStack`, any `[-]` resource or `replace` / `may be replaced` marker needs a stop-and-ask, even if the guard passes.
- "could not assume lookup role" in the log is expected; the diff falls back to `GitHubDiffRole`.

## Dev stage

- URL: https://axiostools-dev.teksnextdoor.com. Stack `WordStudyTool-Dev`, `-dev` physical names, `DESTROY` everywhere, 7-day logs.
- Deploy: every merge to `main` deploys dev. To redeploy manually (e.g. after a destroy): Actions → `deploy-dev` → Run workflow (main only).
- Destroy: Actions → `destroy-dev` → Run workflow with `confirm` = `destroy-dev` (main only). Dev cost drops to $0. Recreating takes a few minutes for cert validation plus the seed.
- Test users (self sign-up is off in dev):

  ```bash
  POOL=$(aws cloudformation describe-stacks --stack-name WordStudyTool-Dev \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
  aws cognito-idp admin-create-user --user-pool-id "$POOL" --username you@example.com
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username you@example.com \
    --password '<password>' --permanent
  ```

- Local config for `npm start`: copy `public/config.example.json` to `public/config.json` (gitignored) and fill it from `aws cloudformation describe-stacks --stack-name WordStudyTool-Dev --query 'Stacks[0].Outputs'` (`ApiUrl`, `UserPoolId`, `UserPoolClientId`, region `us-east-1`). Dev CORS allows `http://localhost:4200`.

## Cost (dev, us-east-1 list prices)

| | Idle | Active (≈1k API calls, 50 AI summaries, 30 deploys / month) |
|---|---|---|
| DynamoDB on-demand | $0.00 | < $0.01 |
| Lambda / API Gateway | $0.00 | ≈ $0.004 |
| Bedrock Haiku 4.5 | $0.00 | ≈ $0.14 |
| S3 site + CDK assets | < $0.01 | ≈ $0.01 |
| CloudFront, ACM, Cognito, IAM OIDC | $0.00 | $0.00 |
| Route 53 queries, CloudWatch Logs (7 days) | $0.00 | < $0.02 |
| GitHub Actions (public repo) | $0.00 | $0.00 |
| Total | ≈ $0.01 / month | ≈ $0.20 / month |

- $0 after `destroy-dev`. Keeping dev deployed is recommended since idle is effectively free.
- Bedrock is the main variable. No test or smoke step calls it, and dev self sign-up is off so strangers cannot run summaries.
- Cost controls: on-demand everything, no VPC/NAT or always-on resources, 1-week dev logs, small seed, npm cache in CI, `pr-<n>` concurrency cancels superseded PR runs, docs-only changes skip deploys.
- Prod delta from the pipeline work: ≈ $0.02 / month (PITR on `WordStudies`, deploy logs).

## One-time manual setup (user)

1. Back up prod data: `aws dynamodb create-backup --table-name WordStudies --backup-name pre-pipeline-$(date +%F)`.
2. Deploy the OIDC stack: `npm run build && cd infra && npx cdk deploy PipelineBootstrapStack`.
3. GitHub environments:

   ```bash
   gh api -X PUT repos/trsam1/sbs-assist/environments/dev \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/trsam1/sbs-assist/environments/dev/deployment-branch-policies -f name=main -f type=branch
   gh api -X PUT repos/trsam1/sbs-assist/environments/prod \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true' \
     -F 'reviewers[][type]=User' -F "reviewers[][id]=$(gh api users/trsam1 --jq .id)" -F prevent_self_review=false
   gh api -X POST repos/trsam1/sbs-assist/environments/prod/deployment-branch-policies -f name=main -f type=branch
   ```

4. After the first green run, protect `main`: require a PR, required status check `ci-ok` only (not `verify` or `diff`; skipped reusable-workflow jobs never report under their nested names), no force pushes, "include administrators" off.
5. Actions setting: "Require approval for all outside collaborators" (public repo).

## Operations notes

- Prod approval more than 7 days after the merge: the `site-dist` artifact has expired and the prod job fails at download. Use "Re-run all jobs" on that `deploy.yml` run.
- Legacy prod log groups `/aws/lambda/{StrongsLookup,StudyCRUD,AISummary}` no longer receive logs and have no expiry. Optional one-time cleanup:

  ```bash
  for fn in StrongsLookup StudyCRUD AISummary; do
    aws logs put-retention-policy --log-group-name "/aws/lambda/$fn" --retention-in-days 90
  done
  ```

## Agent intake

A human files a GitHub issue (the `.github/ISSUE_TEMPLATE/agent-task.yml` form, phone-friendly) and labels it `agent-ready`. The orchestrator later runs one `agent-issue` recipe per issue, which implements it on an `agent/*` branch and opens a CI-gated PR. The intake form, labels, PR template, and recipe are config + docs only; agent runs go through the same CI/PR/dev-deploy flow as any other change.

- Labels (`scripts/agent-labels.sh` creates them, idempotent): `agent-ready` (queued) → `agent-in-progress` (an agent is working it) → `agent-pr-open` (a PR is open). Off-ramps: `agent-blocked` (agent stopped, needs a human answer — see the issue comment) and `needs-human` (out of agent scope, a human must decide first).
- "work issue N": run the recipe for one issue — `run_workflow` with `workflowPath` = `/home/timothy/Code/sbs-assist/.kiro/workflows/agent-issue.workflow.json` and inputs `{"issue_number": N}`.
- "work the queue": `gh issue list --label agent-ready --json number,title`, then one `run_workflow` run per issue (same `workflowPath` + inputs), at most 2 concurrently. Skip any issue already labeled `agent-in-progress`.
- Writing a good agent issue: one outcome; a verifiable acceptance checklist (`- [ ]` lines); set Area; check the risk boxes honestly — a checked box (data/user-pool/DNS/prod config, or needs a design decision) means a human weighs in first and the agent will refuse. Keep scope small.
- Cost: each issue run consumes Kiro credits, so keep issues small and focused. The recipe never touches AWS and CI never calls Bedrock; docs/config-only PRs skip deploys, so AWS cost is ≈ $0 for those.

## Spec stage (enhancing a request into a spec)

Some work arrives already well-specified; some arrives as a thin idea. There are two entry paths, and the only difference is whether a spec gets drafted and reviewed first.

- **Well-specified work** → the `agent-task.yml` form → label `agent-ready` → the `agent-issue` build recipe implements it and opens a CI-gated PR. This is the existing path and is unchanged.
- **Underspecified feature** → the `feature-request.yml` form → label `needs-spec` → the `spec-draft` recipe drafts a reviewed spec and opens a spec PR → the user reviews and merges the spec PR (this merge is the design-approval gate) → the user relabels the issue `agent-ready` → the `agent-issue` build recipe implements the committed spec. No app code is written until the spec PR is merged.

The spec PR changes only `.kiro/specs/**`, so CI's `ci-ok` passes or skips; the spec-draft recipe does not drive CI, and the issue stays open (the spec PR uses `Refs #`, not `Closes #`) so it can move on to the build phase.

### Label lifecycle (spec stage)

`scripts/agent-labels.sh` creates these alongside the agent-* labels (idempotent):

- `needs-spec` (a feature request queued for a spec) → `spec-in-progress` (the spec-draft recipe is drafting) → `spec-pr-open` (spec PR awaiting the user's review/merge).
- After the user merges the spec PR, the user relabels the issue `agent-ready` and it rejoins the normal `agent-ready` → `agent-in-progress` → `agent-pr-open` build lifecycle.
- The spec-draft recipe also tolerates an issue re-pointed here while carrying `agent-blocked` or `needs-human`: intake removes those when it takes the issue.

### Running the spec stage

- "draft a spec for issue N" / an issue labeled `needs-spec`: run the recipe — `run_workflow` with `workflowPath` = `/home/timothy/Code/sbs-assist/.kiro/workflows/spec-draft.workflow.json` and inputs `{"issue_number": N}`. One run per issue.
- When to use it: features and anything underspecified where the acceptance criteria and approach are not yet pinned down. Skip it for small fixes and one-liners — those go straight to `agent-ready` and the build recipe.

### How the build recipe reads a merged spec

When an issue references a committed spec under `.kiro/specs/<slug>/`, the `agent-issue` build recipe reads `requirements.md` for the acceptance criteria and `design.md` for the approach. An issue that references a **merged** spec dir therefore satisfies the build recipe's "verifiable acceptance criteria" requirement — intake does not refuse it for missing criteria.

### Cost

Consistent with the section above: the spec-draft recipe is docs-only (it writes only `.kiro/specs/**`), never touches AWS, and never calls Bedrock, so its AWS cost is ≈ $0. It does consume Kiro credits for the draft/review loop, so reserve it for features that genuinely need a spec rather than small fixes.
