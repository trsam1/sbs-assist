/**
 * Stateful-resource guard.
 *
 * Compares the deployed prod template with the synthesized one and fails when a protected
 * resource (DynamoDB table, Cognito user pool) would be deleted, replaced, orphaned, or is
 * not retained. Runs on every PR and immediately before every prod deploy.
 *
 * Usage: npm run guard -- --deployed <deployed.json> --synth <synth.template.json>
 * Exit codes: 0 ok, 1 violations, 2 usage / unreadable input.
 */
import * as fs from 'fs';
import { fullDiff, ResourceImpact } from '@aws-cdk/cloudformation-diff';

export const PROTECTED_TYPES = ['AWS::DynamoDB::Table', 'AWS::Cognito::UserPool'] as const;

interface TemplateResource {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  [key: string]: unknown;
}
export interface Template {
  Resources?: Record<string, TemplateResource>;
  [key: string]: unknown;
}
export interface Violation {
  logicalId: string;
  type: string;
  reason: string;
}
export interface GuardResult {
  violations: Violation[];
  /** New protected resources (allowed; listed for visibility). */
  info: Violation[];
}

const BLOCKING_IMPACTS = new Set<ResourceImpact>([
  ResourceImpact.WILL_REPLACE,
  ResourceImpact.MAY_REPLACE,
  ResourceImpact.WILL_DESTROY,
  ResourceImpact.WILL_ORPHAN,
]);

const isProtected = (type: string | undefined): boolean =>
  !!type && (PROTECTED_TYPES as readonly string[]).includes(type);

/** Pure core: all four rules, with new protected resources reported as info. */
export function evaluateDetailed(deployed: Template, synthesized: Template): GuardResult {
  const violations: Violation[] = [];
  const info: Violation[] = [];
  const before = deployed.Resources ?? {};
  const after = synthesized.Resources ?? {};

  // Rule 1: every deployed protected resource still exists with the same type.
  for (const [logicalId, r] of Object.entries(before)) {
    if (!isProtected(r.Type)) continue;
    const next = after[logicalId];
    if (!next) violations.push({ logicalId, type: r.Type, reason: 'deleted' });
    else if (next.Type !== r.Type)
      violations.push({ logicalId, type: r.Type, reason: `type changed to ${next.Type}` });
  }

  // Rule 2: no replacement / destroy / orphan impact on a protected resource.
  const diff = fullDiff(deployed, synthesized);
  diff.resources.forEachDifference((logicalId, change) => {
    const type = change.oldResourceType ?? change.newResourceType;
    if (!isProtected(type) || change.isAddition || change.isRemoval) return;
    const impact = change.changeImpact;
    if (BLOCKING_IMPACTS.has(impact)) {
      const props: string[] = [];
      change.forEachDifference((_kind, name) => props.push(name));
      violations.push({
        logicalId,
        type: type!,
        reason: `${impact} (${props.join(', ') || 'no property detail'})`,
      });
    }
  });

  // Rule 3: every synthesized protected resource is retained. Rule 4: new ones are info.
  for (const [logicalId, r] of Object.entries(after)) {
    if (!isProtected(r.Type)) continue;
    if (r.DeletionPolicy !== 'Retain' || r.UpdateReplacePolicy !== 'Retain') {
      violations.push({
        logicalId,
        type: r.Type,
        reason: `not retained (DeletionPolicy=${r.DeletionPolicy ?? 'unset'}, UpdateReplacePolicy=${r.UpdateReplacePolicy ?? 'unset'})`,
      });
    }
    if (!before[logicalId])
      info.push({ logicalId, type: r.Type, reason: 'new protected resource' });
  }
  return { violations, info };
}

/** Violations only (see evaluateDetailed). */
export function evaluate(deployed: Template, synthesized: Template): Violation[] {
  return evaluateDetailed(deployed, synthesized).violations;
}

const USAGE =
  'Usage: stateful-guard --deployed <deployed-template.json> --synth <synth-template.json>';

class UsageError extends Error {}

function argValue(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (!v || v.startsWith('--')) throw new UsageError(`Missing ${name}`);
  return v;
}

function readJson(file: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new UsageError(`Cannot read ${label} file: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(
      `${label === 'deployed' ? 'Deployed' : 'Synthesized'} template is not JSON`,
    );
  }
}

/**
 * `aws cloudformation get-template --query TemplateBody --output json` yields either the
 * template object or a JSON string holding the template body; accept both.
 */
function toTemplate(value: unknown, label: string): Template {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new UsageError(
        `${label === 'deployed' ? 'Deployed' : 'Synthesized'} template is not JSON`,
      );
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new UsageError(
      `${label === 'deployed' ? 'Deployed' : 'Synthesized'} template is not JSON`,
    );
  }
  return v as Template;
}

function table(rows: Violation[]): string {
  return [
    '| Logical ID | Type | Reason |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.logicalId} | ${r.type} | ${r.reason} |`),
  ].join('\n');
}

/** CLI entry. Returns the exit code; never calls process.exit. */
export function main(argv: string[]): number {
  let deployed: Template;
  let synthesized: Template;
  try {
    deployed = toTemplate(readJson(argValue(argv, '--deployed'), 'deployed'), 'deployed');
    synthesized = toTemplate(readJson(argValue(argv, '--synth'), 'synth'), 'synth');
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      console.error(USAGE);
      return 2;
    }
    throw err;
  }

  const { violations, info } = evaluateDetailed(deployed, synthesized);
  if (info.length > 0) {
    console.log('### Stateful guard: new protected resources (allowed)\n');
    console.log(table(info) + '\n');
  }
  if (violations.length > 0) {
    console.log('### ❌ Stateful guard: violations\n');
    console.log(table(violations));
    return 1;
  }
  console.log('✅ No stateful-resource replacement or deletion');
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
