import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluate, evaluateDetailed, main, Template } from './stateful-guard';

function table(overrides: Record<string, unknown> = {}, policies = { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' }) {
  return {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: 'WordStudies',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      ...overrides,
    },
    ...policies,
  };
}

function userPool(overrides: Record<string, unknown> = {}) {
  return {
    Type: 'AWS::Cognito::UserPool',
    Properties: { UserPoolName: 'WordStudyUserPool', UsernameAttributes: ['email'], ...overrides },
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  };
}

function fn(runtime: string) {
  return {
    Type: 'AWS::Lambda::Function',
    Properties: { FunctionName: 'StudyCRUD', Runtime: runtime, Handler: 'index.handler', Role: 'arn:aws:iam::1:role/r' },
  };
}

function base(): Template {
  return { Resources: { WordStudiesA: table(), PoolA: userPool(), FnA: fn('nodejs20.x') } };
}

describe('evaluate (AC8)', () => {
  it('fails when a table is removed', () => {
    const synth = base();
    delete synth.Resources!['WordStudiesA'];
    expect(evaluate(base(), synth)).toEqual([
      { logicalId: 'WordStudiesA', type: 'AWS::DynamoDB::Table', reason: 'deleted' },
    ]);
  });

  it('fails on a key-schema change (replacement)', () => {
    const synth = base();
    synth.Resources!['WordStudiesA'] = table({
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    });
    const v = evaluate(base(), synth);
    expect(v).toHaveLength(1);
    expect(v[0].logicalId).toBe('WordStudiesA');
    expect(v[0].reason).toMatch(/WILL_REPLACE/);
    expect(v[0].reason).toMatch(/KeySchema/);
  });

  it('fails on a TableName change (replacement)', () => {
    const synth = base();
    synth.Resources!['WordStudiesA'] = table({ TableName: 'WordStudies2' });
    const v = evaluate(base(), synth);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/WILL_REPLACE.*TableName/);
  });

  it('fails on a user-pool replacement (construct renamed → new logical ID)', () => {
    // CloudFormation's spec marks no UserPool property as replace-on-change, so in CDK a
    // pool is replaced by a logical-ID change: the old ID disappears, a new one appears.
    const synth = base();
    delete synth.Resources!['PoolA'];
    synth.Resources!['PoolRenamed'] = userPool();
    const r = evaluateDetailed(base(), synth);
    expect(r.violations).toEqual([{ logicalId: 'PoolA', type: 'AWS::Cognito::UserPool', reason: 'deleted' }]);
    expect(r.info.map((i) => i.logicalId)).toEqual(['PoolRenamed']);
  });

  it('fails when a protected resource is not retained', () => {
    const synth = base();
    synth.Resources!['WordStudiesA'] = table({}, { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
    const v = evaluate(base(), synth);
    expect(v).toEqual([
      {
        logicalId: 'WordStudiesA',
        type: 'AWS::DynamoDB::Table',
        reason: 'not retained (DeletionPolicy=Delete, UpdateReplacePolicy=Delete)',
      },
    ]);
  });

  it('passes on a benign Lambda change', () => {
    const synth = base();
    synth.Resources!['FnA'] = fn('nodejs22.x');
    expect(evaluate(base(), synth)).toEqual([]);
  });

  it('passes on Delete → Retain and an added PITR spec (the real prod change)', () => {
    const deployed = base();
    deployed.Resources!['WordStudiesA'] = table({}, { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
    const synth = base();
    synth.Resources!['WordStudiesA'] = table({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } });
    expect(evaluate(deployed, synth)).toEqual([]);
  });

  it('fails when a protected resource changes type', () => {
    const synth = base();
    synth.Resources!['PoolA'] = { Type: 'AWS::DynamoDB::GlobalTable', Properties: {} } as never;
    expect(evaluate(base(), synth)[0]).toMatchObject({ logicalId: 'PoolA', reason: 'type changed to AWS::DynamoDB::GlobalTable' });
  });

  it('lists new protected resources as info, not violations', () => {
    const synth = base();
    synth.Resources!['NewTable'] = table({ TableName: 'Other' });
    const r = evaluateDetailed(base(), synth);
    expect(r.violations).toEqual([]);
    expect(r.info).toEqual([{ logicalId: 'NewTable', type: 'AWS::DynamoDB::Table', reason: 'new protected resource' }]);
  });
});

describe('main (CLI)', () => {
  let dir: string;
  const write = (name: string, content: unknown) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns 0 for identical templates', () => {
    const f = write('same.json', base());
    expect(main(['--deployed', f, '--synth', f])).toBe(0);
  });

  it('returns 1 on a violation', () => {
    const synth = base();
    delete synth.Resources!['PoolA'];
    expect(main(['--deployed', write('d1.json', base()), '--synth', write('s1.json', synth)])).toBe(1);
  });

  it('accepts a deployed template whose body is a JSON string', () => {
    const deployed = write('d-string.json', JSON.stringify(JSON.stringify(base())));
    expect(main(['--deployed', deployed, '--synth', write('s2.json', base())])).toBe(0);
  });

  it('returns 2 when the deployed body is a non-JSON string (e.g. YAML)', () => {
    const deployed = write('d-yaml.json', JSON.stringify('Resources:\n  A: {}\n'));
    expect(main(['--deployed', deployed, '--synth', write('s3.json', base())])).toBe(2);
    expect(console.error).toHaveBeenCalledWith('Deployed template is not JSON');
  });

  it('returns 2 when a file is not JSON at all', () => {
    expect(main(['--deployed', write('bad.json', '{nope'), '--synth', write('s4.json', base())])).toBe(2);
  });

  it('returns 2 on missing arguments', () => {
    expect(main([])).toBe(2);
    expect(main(['--deployed', write('d5.json', base())])).toBe(2);
    expect(main(['--deployed', '--synth', 'x'])).toBe(2);
  });

  it('returns 2 on unreadable files', () => {
    expect(main(['--deployed', path.join(dir, 'missing.json'), '--synth', path.join(dir, 'missing2.json')])).toBe(2);
  });
});
