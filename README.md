# WordStudyTool

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.8.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## End-to-end tests

There is no browser e2e suite and no `e2e` target. `src/app/e2e-integration.spec.ts` is an integration test of the study flow that runs inside `ng test` with mocked HTTP. Post-deploy checks run in CI via `scripts/ci/smoke-test.sh`.

## Development & delivery

- Node 22 (`.nvmrc`). Install with `npm ci && npm ci --prefix infra`.
- `npm run verify` runs the full gate that CI runs: lint, format check, frontend tests, build, infra typecheck, infra tests, and `cdk synth` for every stack.
- `npm start` needs a local `public/config.json` (copy `public/config.example.json` and fill in the dev stack outputs).
- Deploys happen only through GitHub Actions: PR → merge → dev → prod (with approval). See [.kiro/steering/delivery.md](.kiro/steering/delivery.md) for the flow, dev deploy/destroy, costs, and one-time setup, and [docs/domain-cutover.md](docs/domain-cutover.md) for the planned `axiostools.teksnextdoor.com` move.

## Working with agents

Some work is handled by AI agents. A human files a GitHub issue using the `agent-task` issue form and labels it `agent-ready`; an agent then picks it up, implements it on an `agent/*` branch, and opens a CI-gated PR that goes through the same checks as any other change.

- To queue agent work: open an issue with the `agent-task` form and add the `agent-ready` label.
- For the full flow, labels, and CI gating, see [.kiro/steering/delivery.md](.kiro/steering/delivery.md).

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
