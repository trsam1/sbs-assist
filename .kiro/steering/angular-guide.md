---
inclusion: fileMatch
fileMatchPattern: ['**/*.ts', '**/*.html', '**/*.scss', '**/*.css']
---

# Angular & TypeScript Conventions

Target version: Angular v20+. All generated code must be functional, maintainable, performant, and accessible.

## TypeScript

- Enable strict type checking (`strict: true` in tsconfig).
- Prefer type inference where the type is obvious; explicitly annotate public APIs and function signatures.
- Never use `any`. Use `unknown` when the type is uncertain, then narrow with type guards.
- Prefer `interface` for object shapes; use `type` for unions, intersections, and mapped types.

## Angular General

- Always use standalone components. Never use NgModules for declaring components, directives, or pipes.
- Do NOT set `standalone: true` in decorators — it is the default in Angular v20+.
- Use `inject()` for dependency injection. Do not use constructor-based injection.
- Implement lazy loading for all feature routes via `loadComponent` / `loadChildren`.
- Use `NgOptimizedImage` for all static `<img>` elements. It does not support inline base64 sources.
- Do NOT use `@HostBinding` or `@HostListener`. Use the `host` property in `@Component` / `@Directive` metadata instead.

## Components

- One responsibility per component. Keep components small and focused.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in every `@Component` decorator.
- Use `input()` and `output()` signal-based functions instead of `@Input()` / `@Output()` decorators.
- Use `computed()` for any derived state.
- Prefer inline templates for components with fewer than ~20 lines of markup.
- When using external templates or styles, reference them with paths relative to the component file.
- Prefer Reactive Forms over Template-driven Forms.

## Templates

- Use native control flow blocks: `@if`, `@for`, `@switch`. Do NOT use `*ngIf`, `*ngFor`, or `*ngSwitch`.
- Use `class` bindings instead of `ngClass`. Use `style` bindings instead of `ngStyle`.
- Use the `async` pipe to subscribe to observables in templates.
- Keep template expressions simple — move complex logic into the component class or `computed()` signals.
- Do not reference browser globals (e.g., `new Date()`, `window`, `document`) directly in templates.

## State Management

- Use signals for local component state.
- Use `computed()` for derived state.
- Keep all state transformations pure and predictable.
- Modify signals with `set()` or `update()` only. Do NOT use `mutate`.

## Services

- One responsibility per service.
- Use `providedIn: 'root'` for singleton services.
- Use `inject()` for all dependency injection within services.

## Bulma CSS

- Use Bulma classes for all layout and styling. Do not write custom CSS for things Bulma already provides (grid, spacing, typography, buttons, forms, modals, etc.).
- Do NOT install or import Bulma's JavaScript — Angular handles all interactivity. Only use Bulma as a pure CSS framework.
- Toggle Bulma stateful classes (e.g., `is-active`, `is-loading`) via Angular class bindings, not JavaScript.
- Use Bulma's responsive helpers (`is-hidden-mobile`, column sizing) for responsive design.
- When Bulma doesn't cover a need, write component-scoped SCSS. Avoid global style overrides.
- Do not mix Bulma with other CSS frameworks or utility-class libraries.

## Accessibility

- All UI must meet WCAG 2.1 AA requirements at minimum, including focus management, color contrast, and correct ARIA attributes.
- All components must pass Axe automated accessibility checks.
- Use semantic HTML elements before adding ARIA roles.
- Ensure all interactive elements are keyboard-navigable.
