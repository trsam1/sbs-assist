# Project Structure

Two packages: the Angular app at the repo root and the CDK app plus Lambdas in `infra/`.

```
.
├── src/app/                  # Angular app (standalone components, signals)
│   ├── */                    # Components: study-input, study-page, study-worksheet, study-list, auth
│   ├── *.service.ts          # API services (study-crud, strongs-lookup, ai-summary, english-definition, auth)
│   ├── environment.ts        # Runtime config holder (empty until /config.json loads; no IDs committed)
│   ├── runtime-config.ts     # Loads + validates /config.json before Amplify is configured
│   └── english-definition.normalize.ts  # Tolerant reader for legacy string englishDefinition
├── public/                   # Static files copied into dist (favicon, config.example.json)
├── infra/                    # CDK app + Lambdas (CommonJS, vitest)
│   ├── bin/word-study-tool.ts       # CDK entry: WordStudyToolStack (prod), WordStudyTool-Dev, PipelineBootstrapStack
│   ├── lib/word-study-tool-stack.ts # The app stack (one per stage)
│   ├── lib/stage-config.ts          # ALL per-stage values (prod identity frozen)
│   ├── lib/pipeline-bootstrap-stack.ts  # GitHub OIDC provider + GitHubDeployRole / GitHubDiffRole
│   ├── lambda/{strongs-lookup,study-crud,ai-summary,shared}/  # Lambda handlers + shared models/CORS
│   ├── scripts/              # Seeds (prod one-offs, dev subset), stateful guard, export
│   │   └── fixtures/         # Committed dev Strong's subset (generated; never hand-edit or reformat)
│   └── test/                 # CDK assertion tests, no-AWS test setup, fixture site
├── scripts/
│   ├── ci/                   # Bash helpers for workflows (smoke test, PR comment)
│   └── agent-labels.sh       # Idempotent agent-intake label bootstrap (run from repo root)
├── .github/
│   ├── workflows/            # verify, pr, deploy, deploy-stage, deploy-dev, destroy-dev
│   ├── ISSUE_TEMPLATE/       # agent-task + feature-request + bug issue forms, config
│   └── pull_request_template.md  # Summary / Tests run / Risks + Closes #
├── docs/                     # Runbooks (domain cutover)
├── .kiro/
│   ├── specs/                # Feature and bugfix specs
│   ├── steering/             # Steering rules for AI assistance
│   └── workflows/            # agent-issue (build recipe) + spec-draft (feature → reviewed spec PR) recipes
└── .agents/                  # Agent scratch (gitignored)
```

## Conventions

- Tests sit next to their source: `*.spec.ts` (frontend, Angular + vitest), `*.test.ts` (infra, vitest). CDK assertion tests live in `infra/test/`.
- Stage-specific values live only in `infra/lib/stage-config.ts`. Never hardcode a stage name, domain, or physical name elsewhere.
- Construct IDs and stateful physical names are frozen once deployed. Add new constructs; never rename existing ones.
- Scripts that are also imported by tests export their logic and run `main()` only under `require.main === module`.
