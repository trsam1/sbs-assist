---
inclusion: always
---

# Tech Stack

## Frontend

- Angular 21 (standalone components, signals)
- Bulma CSS framework for styling and layout
- TypeScript with strict mode enabled

## Backend & Infrastructure

- AWS services, chosen for simplicity and cost efficiency
- Prefer serverless-first: Lambda, API Gateway, DynamoDB, S3, CloudFront
- Use AWS CDK (TypeScript) for infrastructure-as-code
- Avoid over-engineering — pick the simplest AWS service that meets the requirement
- CI/CD: GitHub Actions on GitHub-hosted runners, AWS access via GitHub OIDC (short-lived role sessions; no stored AWS keys). See `delivery.md`.

## Design Principles

- Simplicity over complexity in all architecture decisions
- Cost efficiency — prefer pay-per-use services, avoid always-on resources where possible
- Serverless-first — use managed services to minimize operational overhead
- Keep the number of distinct AWS services small; don't introduce a service without a clear need

## Code Generation

- Do not modify code when discussing features or changes, without permission to make proposed updates

## Build & Run Commands

Node 22 (`.nvmrc`). All dependencies are pinned to exact versions.

| Task | Command |
|------|---------|
| Install dependencies | `npm ci && npm ci --prefix infra` |
| Dev server | `npm start` (needs `public/config.json`, see `delivery.md`) |
| Build (prod) | `npm run build` |
| Run tests | `npm run test:ci` and `npm --prefix infra test` |
| Lint | `npm run lint` |
| Format | `npm run format:check` / `npm run format` |
| Full gate (what CI runs) | `npm run verify` |
| CDK diff | `npm run build && cd infra && npx cdk diff WordStudyTool-Dev --method template` |
| CDK deploy | CI only. Locally, only the user deploys `PipelineBootstrapStack`: `npm run build && cd infra && npx cdk deploy PipelineBootstrapStack` |
