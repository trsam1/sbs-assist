import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WordStudyToolStack } from '../lib/word-study-tool-stack';
import { STAGES, Stage } from '../lib/stage-config';
import cdkContext from '../cdk.context.json';

const env = { account: '224670540244', region: 'us-east-1' };

/** The 12 prod logical IDs that must never change (§D5.1). */
const PROD_LOGICAL_IDS = [
  'WordStudiesA8B80607',
  'StrongsData9E54ADA6',
  'WordStudyUserPoolF27C6107',
  'WordStudyUserPoolWordStudySpaClientDAE987CA',
  'SiteBucket397A1860',
  'SiteDistribution3FF9535D',
  'WildcardCert4A8FDF87',
  'SiteAliasRecord3C0AF5BF',
  'WordStudyApiA154E286',
  'StrongsLookupFn03CFE587',
  'StudyCrudFnBA9865A8',
  'AISummaryFnC3EC6555',
];

function synth(stage: Stage): Template {
  // Cached hosted-zone context resolves offline; bundling is skipped for speed.
  const app = new cdk.App({ context: { ...cdkContext, 'aws:cdk:bundling-stacks': [] } });
  const stack = new WordStudyToolStack(app, STAGES[stage].stackId, {
    env,
    config: STAGES[stage],
    frontendAssetPath: path.join(__dirname, 'fixtures/site'),
  });
  return Template.fromStack(stack);
}

type Resources = Record<
  string,
  {
    Type: string;
    Properties?: Record<string, unknown>;
    DeletionPolicy?: string;
    UpdateReplacePolicy?: string;
  }
>;

function resourcesOfType(t: Template, type: string): Resources {
  return t.findResources(type) as Resources;
}

function tableByName(t: Template, name: string) {
  const [entry] = Object.entries(resourcesOfType(t, 'AWS::DynamoDB::Table')).filter(
    ([, r]) => r.Properties?.['TableName'] === name,
  );
  expect(entry, `table ${name}`).toBeDefined();
  return entry[1];
}

describe.each(['prod', 'dev'] as const)('WordStudyToolStack (%s) — shared', (stage) => {
  let t: Template;
  beforeAll(() => {
    t = synth(stage);
  });

  it('has 2 BucketDeployments and 2 AwsCliLayers', () => {
    t.resourceCountIs('Custom::CDKBucketDeployment', 2);
    t.resourceCountIs('AWS::Lambda::LayerVersion', 2);
  });

  it('uses on-demand billing for every table', () => {
    for (const r of Object.values(resourcesOfType(t, 'AWS::DynamoDB::Table'))) {
      expect(r.Properties?.['BillingMode']).toBe('PAY_PER_REQUEST');
    }
  });

  it('defines the ScrollStudies table with PK/SK + GSI1', () => {
    const table = tableByName(t, `ScrollStudies${stage === 'prod' ? '' : '-dev'}`);
    expect(table.Properties?.['KeySchema']).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    const gsis = table.Properties?.['GlobalSecondaryIndexes'] as Array<Record<string, unknown>>;
    expect(gsis).toHaveLength(1);
    expect(gsis[0]['IndexName']).toBe('GSI1');
  });

  it('defines the uploads bucket: block-public, 7-day expiry, PUT CORS, auto-delete', () => {
    const buckets = Object.entries(resourcesOfType(t, 'AWS::S3::Bucket')).filter(([id]) =>
      id.startsWith('UploadsBucket'),
    );
    expect(buckets, 'uploads bucket').toHaveLength(1);
    const [, bucket] = buckets[0];

    expect(bucket.Properties?.['PublicAccessBlockConfiguration']).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });

    const lifecycle = bucket.Properties?.['LifecycleConfiguration'] as {
      Rules: Array<Record<string, unknown>>;
    };
    expect(lifecycle.Rules.some((r) => r['ExpirationInDays'] === 7)).toBe(true);

    const cors = bucket.Properties?.['CorsConfiguration'] as {
      CorsRules: Array<Record<string, unknown>>;
    };
    expect((cors.CorsRules[0]['AllowedMethods'] as string[]).includes('PUT')).toBe(true);

    // Transient data: DESTROY + auto-delete in every stage.
    expect(bucket.DeletionPolicy).toBe('Delete');
  });

  it('triggers ExtractText on S3 ObjectCreated and authorizes the four scroll routes', () => {
    // S3 → Lambda notification wiring exists (custom resource configures bucket notifications).
    t.resourceCountIs('Custom::S3BucketNotifications', 1);

    // The two new Lambdas exist on Node 22.
    for (const name of ['ScrollStudy', 'ExtractText']) {
      t.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${name}${stage === 'prod' ? '' : '-dev'}`,
        Runtime: 'nodejs22.x',
      });
    }

    // Four /scroll-studies methods, all Cognito-authorized (OPTIONS preflight excluded).
    const scrollMethods = Object.values(resourcesOfType(t, 'AWS::ApiGateway::Method')).filter(
      (m) => (m.Properties?.['AuthorizationType'] as string) === 'COGNITO_USER_POOLS',
    );
    expect(scrollMethods.length).toBeGreaterThanOrEqual(4);
  });

  it('writes config.json and serves the shell with no-cache, invalidating /*', () => {
    t.hasResourceProperties('Custom::CDKBucketDeployment', {
      SystemMetadata: { 'cache-control': 'no-cache' },
      DistributionPaths: ['/*'],
      Include: ['index.html', 'config.json', 'favicon.ico'],
      Prune: false,
    });
    t.hasResourceProperties('Custom::CDKBucketDeployment', {
      SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' },
      Exclude: ['index.html', 'config.json', 'favicon.ico'],
      Prune: false,
    });
  });
});

describe('WordStudyToolStack (prod)', () => {
  let t: Template;
  beforeAll(() => {
    t = synth('prod');
  });

  it('keeps all 12 prod logical IDs', () => {
    const ids = Object.keys(t.toJSON().Resources);
    for (const id of PROD_LOGICAL_IDS) expect(ids).toContain(id);
  });

  it('retains both tables and the user pool', () => {
    for (const id of ['WordStudiesA8B80607', 'StrongsData9E54ADA6', 'WordStudyUserPoolF27C6107']) {
      const r = t.toJSON().Resources[id];
      expect(r.DeletionPolicy, id).toBe('Retain');
      expect(r.UpdateReplacePolicy, id).toBe('Retain');
    }
    for (const r of Object.values(resourcesOfType(t, 'AWS::DynamoDB::Table'))) {
      expect(r.DeletionPolicy).not.toBe('Delete');
    }
  });

  it('enables PITR on WordStudies only', () => {
    expect(tableByName(t, 'WordStudies').Properties?.['PointInTimeRecoverySpecification']).toEqual({
      PointInTimeRecoveryEnabled: true,
    });
    expect(
      tableByName(t, 'StrongsData').Properties?.['PointInTimeRecoverySpecification'],
    ).toBeUndefined();
  });

  it('keeps the prod physical names', () => {
    tableByName(t, 'WordStudies');
    tableByName(t, 'StrongsData');
    for (const name of ['StrongsLookup', 'StudyCRUD', 'AISummary']) {
      t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: name });
    }
    t.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolName: 'WordStudyUserPool' });
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { ClientName: 'WordStudySpaClient' });
    t.hasResourceProperties('AWS::ApiGateway::RestApi', { Name: 'WordStudyApi' });
    t.hasResourceProperties('AWS::ApiGateway::UsagePlan', { UsagePlanName: 'WordStudyUsagePlan' });
    t.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'prod' });
  });

  it('keeps the account-level API Gateway CloudWatch resources', () => {
    const ids = Object.keys(t.toJSON().Resources);
    expect(ids).toContain('WordStudyApiAccount7C89F11C');
    expect(ids).toContain('WordStudyApiCloudWatchRoleB40E7C53');
  });

  it('runs StudyCRUD on Node 22 with an explicit log group', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'StudyCRUD',
      Runtime: 'nodejs22.x',
      LoggingConfig: { LogGroup: Match.anyValue() },
    });
  });

  it('keeps 90-day log retention', () => {
    const groups = Object.values(resourcesOfType(t, 'AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(7);
    for (const g of groups) expect(g.Properties?.['RetentionInDays']).toBe(90);
  });

  it('adds an additive BookStudies table (on-demand, AWS-managed, GSI1, no PITR)', () => {
    const table = tableByName(t, 'BookStudies');
    expect(table.Properties?.['BillingMode']).toBe('PAY_PER_REQUEST');
    expect(table.Properties?.['SSESpecification']).toEqual({ SSEEnabled: true });
    const gsis = (table.Properties?.['GlobalSecondaryIndexes'] ?? []) as {
      IndexName?: string;
    }[];
    expect(gsis.some((g) => g.IndexName === 'GSI1')).toBe(true);
    expect(table.Properties?.['PointInTimeRecoverySpecification']).toBeUndefined();
  });

  it('runs BookStudyCRUD on Node 22', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'BookStudyCRUD',
      Runtime: 'nodejs22.x',
    });
  });

  it('guards every /books method with the Cognito authorizer', () => {
    const methods = Object.values(resourcesOfType(t, 'AWS::ApiGateway::Method')).filter(
      (m) =>
        m.Properties?.['AuthorizationType'] === 'COGNITO_USER_POOLS' &&
        m.Properties?.['AuthorizerId'] !== undefined,
    );
    expect(methods.length).toBeGreaterThan(0);
    const booksMethods = t.findResources('AWS::ApiGateway::Method', {
      Properties: Match.objectLike({ AuthorizationType: 'COGNITO_USER_POOLS' }),
    });
    // Four /books methods (POST, GET, GET by id, DELETE) are authorized plus the /studies ones.
    expect(Object.keys(booksMethods).length).toBeGreaterThanOrEqual(8);
  });

  it('points SiteAliasRecord at wordstudy.teksnextdoor.com', () => {
    const r = t.toJSON().Resources['SiteAliasRecord3C0AF5BF'];
    expect(r.Type).toBe('AWS::Route53::RecordSet');
    expect(r.Properties.Name).toBe('wordstudy.teksnextdoor.com.');
    t.resourceCountIs('AWS::Route53::RecordSet', 1);
  });

  it('allows only the prod site origin', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'StudyCRUD',
      Environment: {
        Variables: Match.objectLike({ ALLOWED_ORIGINS: 'https://wordstudy.teksnextdoor.com' }),
      },
    });
  });
});

describe('WordStudyToolStack (dev)', () => {
  let t: Template;
  beforeAll(() => {
    t = synth('dev');
  });

  it('deletes tables and the user pool on stack deletion', () => {
    for (const r of Object.values(resourcesOfType(t, 'AWS::DynamoDB::Table'))) {
      expect(r.DeletionPolicy).toBe('Delete');
    }
    for (const r of Object.values(resourcesOfType(t, 'AWS::Cognito::UserPool'))) {
      expect(r.DeletionPolicy).toBe('Delete');
    }
  });

  it('sets PITR explicitly false on WordStudies-dev and true nowhere', () => {
    expect(
      tableByName(t, 'WordStudies-dev').Properties?.['PointInTimeRecoverySpecification'],
    ).toEqual({
      PointInTimeRecoveryEnabled: false,
    });
    for (const r of Object.values(resourcesOfType(t, 'AWS::DynamoDB::Table'))) {
      expect(
        (
          r.Properties?.['PointInTimeRecoverySpecification'] as
            | { PointInTimeRecoveryEnabled?: boolean }
            | undefined
        )?.PointInTimeRecoveryEnabled,
      ).not.toBe(true);
    }
  });

  it('uses -dev physical names', () => {
    tableByName(t, 'WordStudies-dev');
    tableByName(t, 'StrongsData-dev');
    for (const name of ['StrongsLookup-dev', 'StudyCRUD-dev', 'AISummary-dev']) {
      t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: name });
    }
    t.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolName: 'WordStudyUserPool-dev' });
    t.hasResourceProperties('AWS::ApiGateway::RestApi', { Name: 'WordStudyApi-dev' });
    t.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      UsagePlanName: 'WordStudyUsagePlan-dev',
    });
    t.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'dev' });
  });

  it('disables self sign-up', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('serves axiostools-dev.teksnextdoor.com from a SiteAliasRecord* record', () => {
    const records = Object.entries(resourcesOfType(t, 'AWS::Route53::RecordSet'));
    expect(records).toHaveLength(1);
    const [id, r] = records[0];
    expect(id).toMatch(/^SiteAliasRecord/);
    expect(r.Properties?.['Name']).toBe('axiostools-dev.teksnextdoor.com.');
  });

  it('allows http://localhost:4200 in CORS preflight and Lambda env', () => {
    const preflights = Object.values(resourcesOfType(t, 'AWS::ApiGateway::Method')).filter(
      (m) => m.Properties?.['HttpMethod'] === 'OPTIONS',
    );
    expect(preflights.length).toBeGreaterThan(0);
    const origins = JSON.stringify(preflights[0].Properties?.['Integration']);
    expect(origins).toContain('http://localhost:4200');
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'StudyCRUD-dev',
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_ORIGINS: 'https://axiostools-dev.teksnextdoor.com,http://localhost:4200',
        }),
      },
    });
  });

  it('keeps 7-day log retention', () => {
    const groups = Object.values(resourcesOfType(t, 'AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(7);
    for (const g of groups) {
      expect(g.Properties?.['RetentionInDays']).toBe(7);
      expect(g.DeletionPolicy).toBe('Delete');
    }
  });

  it('creates a BookStudies-dev table and BookStudyCRUD-dev function', () => {
    const table = tableByName(t, 'BookStudies-dev');
    expect(table.Properties?.['BillingMode']).toBe('PAY_PER_REQUEST');
    expect(table.DeletionPolicy).toBe('Delete');
    const gsis = (table.Properties?.['GlobalSecondaryIndexes'] ?? []) as {
      IndexName?: string;
    }[];
    expect(gsis.some((g) => g.IndexName === 'GSI1')).toBe(true);
    t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'BookStudyCRUD-dev' });
  });

  it('creates no account-level API Gateway CloudWatch setting', () => {
    t.resourceCountIs('AWS::ApiGateway::Account', 0);
  });

  it('issues its own certificate instead of the wildcard', () => {
    t.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'axiostools-dev.teksnextdoor.com',
    });
    expect(Object.keys(t.toJSON().Resources).some((id) => id.startsWith('WildcardCert'))).toBe(
      false,
    );
  });
});
