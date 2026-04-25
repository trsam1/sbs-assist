---
inclusion: always
---

# Tech Stack

## Frontend

- Angular v25+ (standalone components, signals, SSR-ready)
- Bulma CSS framework for styling and layout
- TypeScript with strict mode enabled

## Backend & Infrastructure

- AWS services, chosen for simplicity and cost efficiency
- Prefer serverless-first: Lambda, API Gateway, DynamoDB, S3, CloudFront
- Use AWS CDK (TypeScript) for infrastructure-as-code
- Avoid over-engineering — pick the simplest AWS service that meets the requirement

## Design Principles

- Simplicity over complexity in all architecture decisions
- Cost efficiency — prefer pay-per-use services, avoid always-on resources where possible
- Serverless-first — use managed services to minimize operational overhead
- Keep the number of distinct AWS services small; don't introduce a service without a clear need

## Code Generation

- Do not modify code when discussing features or changes, without permission to make proposed updates


## Build & Run Commands

_To be updated once the project is scaffolded._

| Task | Command |
|------|---------|
| Install dependencies | `npm install` |
| Dev server | `ng serve` |
| Build (prod) | `ng build` |
| Run tests | `ng test` |
| Lint | `ng lint` |
| CDK deploy | `npx cdk deploy` |
| CDK diff | `npx cdk diff` |
