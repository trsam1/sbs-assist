import { describe, it, expect, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PipelineBootstrapStack } from '../lib/pipeline-bootstrap-stack';

const ACCOUNT = '224670540244';

type Statement = { Sid?: string; Action: string | string[]; Resource: unknown; Effect: string; Condition?: unknown };
type Resource = { Type: string; Properties: Record<string, unknown> };

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

describe('PipelineBootstrapStack', () => {
  let t: Template;
  let resources: Record<string, Resource>;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new PipelineBootstrapStack(app, 'PipelineBootstrapStack', {
      env: { account: ACCOUNT, region: 'us-east-1' },
    });
    t = Template.fromStack(stack);
    resources = t.toJSON().Resources;
  });

  function roleId(roleName: string): string {
    const [id] = Object.entries(resources).find(
      ([, r]) => r.Type === 'AWS::IAM::Role' && r.Properties['RoleName'] === roleName,
    )!;
    return id;
  }

  /** Every statement of every AWS::IAM::Policy attached to the role. */
  function statementsFor(roleName: string): Statement[] {
    const id = roleId(roleName);
    return Object.values(resources)
      .filter(
        (r) =>
          r.Type === 'AWS::IAM::Policy' &&
          asArray(r.Properties['Roles'] as unknown[]).some((ref) => JSON.stringify(ref) === JSON.stringify({ Ref: id })),
      )
      .flatMap((p) => (p.Properties['PolicyDocument'] as { Statement: Statement[] }).Statement);
  }

  function trust(roleName: string) {
    return (resources[roleId(roleName)].Properties['AssumeRolePolicyDocument'] as { Statement: Statement[] }).Statement;
  }

  it('creates the GitHub OIDC provider for sts.amazonaws.com', () => {
    t.resourceCountIs('AWS::IAM::OIDCProvider', 1);
    t.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('has exactly two roles with 1h sessions', () => {
    t.resourceCountIs('AWS::IAM::Role', 2);
    for (const name of ['GitHubDeployRole', 'GitHubDiffRole']) {
      expect(resources[roleId(name)].Properties['MaxSessionDuration']).toBe(3600);
    }
  });

  it('trusts GitHubDeployRole only from the dev and prod environments (exact match)', () => {
    const [stmt, ...rest] = trust('GitHubDeployRole');
    expect(rest).toHaveLength(0);
    expect(stmt.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(stmt.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': [
          'repo:trsam1/sbs-assist:environment:dev',
          'repo:trsam1/sbs-assist:environment:prod',
        ],
      },
    });
  });

  it('trusts GitHubDiffRole only from pull_request (exact match)', () => {
    const [stmt, ...rest] = trust('GitHubDiffRole');
    expect(rest).toHaveLength(0);
    expect(stmt.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': ['repo:trsam1/sbs-assist:pull_request'],
      },
    });
  });

  it('uses no StringLike or wildcard anywhere in either trust policy', () => {
    const json = JSON.stringify([trust('GitHubDeployRole'), trust('GitHubDiffRole')]);
    expect(json).not.toContain('StringLike');
    expect(json).not.toContain('*');
  });

  it('gives GitHubDeployRole exactly the §D9 statements', () => {
    const stmts = statementsFor('GitHubDeployRole');
    expect(stmts.map((s) => s.Sid).sort()).toEqual(['AssumeCdkRoles', 'ReadProdTemplate', 'SeedDevStrongs']);
    for (const s of stmts) expect(s.Effect).toBe('Allow');

    const assume = stmts.find((s) => s.Sid === 'AssumeCdkRoles')!;
    expect(asArray(assume.Action)).toEqual(['sts:AssumeRole']);
    expect([...asArray(assume.Resource as string[])].sort()).toEqual(
      [
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-deploy-role-${ACCOUNT}-us-east-1`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-file-publishing-role-${ACCOUNT}-us-east-1`,
      ].sort(),
    );

    const read = stmts.find((s) => s.Sid === 'ReadProdTemplate')!;
    expect(asArray(read.Action)).toEqual(['cloudformation:GetTemplate', 'cloudformation:DescribeStacks']);
    expect(read.Resource).toBe(`arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/WordStudyToolStack/*`);

    const seed = stmts.find((s) => s.Sid === 'SeedDevStrongs')!;
    expect(asArray(seed.Action)).toEqual(['dynamodb:GetItem', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem']);
    expect(seed.Resource).toBe(`arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/StrongsData-dev`);
  });

  it('never lets GitHubDeployRole assume the lookup or image-publishing roles', () => {
    const json = JSON.stringify(statementsFor('GitHubDeployRole'));
    expect(json).not.toContain('lookup-role');
    expect(json).not.toContain('image-publishing');
  });

  it('gives GitHubDiffRole exactly the §D9 read-only statements', () => {
    const stmts = statementsFor('GitHubDiffRole');
    expect(stmts.map((s) => s.Sid).sort()).toEqual(['ReadBootstrapVersion', 'ReadStackTemplates']);

    const read = stmts.find((s) => s.Sid === 'ReadStackTemplates')!;
    expect(asArray(read.Action)).toEqual([
      'cloudformation:GetTemplate',
      'cloudformation:DescribeStacks',
      'cloudformation:ListStackResources',
      'cloudformation:GetTemplateSummary',
    ]);
    expect(asArray(read.Resource as string[])).toEqual(
      ['WordStudyToolStack', 'WordStudyTool-Dev', 'PipelineBootstrapStack'].map(
        (s) => `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/${s}/*`,
      ),
    );

    const ssm = stmts.find((s) => s.Sid === 'ReadBootstrapVersion')!;
    expect(asArray(ssm.Action)).toEqual(['ssm:GetParameter']);
    expect(ssm.Resource).toBe(`arn:aws:ssm:us-east-1:${ACCOUNT}:parameter/cdk-bootstrap/hnb659fds/version`);
  });

  it('gives GitHubDiffRole no sts:AssumeRole action', () => {
    const actions = statementsFor('GitHubDiffRole').flatMap((s) => asArray(s.Action));
    expect(actions.some((a) => a.toLowerCase().startsWith('sts:'))).toBe(false);
  });

  it('attaches no managed policies to either role', () => {
    for (const name of ['GitHubDeployRole', 'GitHubDiffRole']) {
      expect(resources[roleId(name)].Properties['ManagedPolicyArns']).toBeUndefined();
    }
  });

  it('outputs both role ARNs', () => {
    t.hasOutput('DeployRoleArn', {});
    t.hasOutput('DiffRoleArn', {});
  });
});
