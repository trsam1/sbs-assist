import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export const GITHUB_REPO = 'trsam1/sbs-assist';
const OIDC_HOST = 'token.actions.githubusercontent.com';

/**
 * GitHub Actions OIDC provider plus the two CI roles. Deployed ONLY by the user, locally
 * (`npm run build && cd infra && npx cdk deploy PipelineBootstrapStack`); CI never deploys
 * it, so CI roles cannot widen their own trust.
 */
export class PipelineBootstrapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const account = this.account;
    const region = this.region;

    // No thumbprints: IAM manages the trust chain for this well-known issuer.
    const provider = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: `https://${OIDC_HOST}`,
      clientIds: ['sts.amazonaws.com'],
    });

    /** Exact-match trust on audience and subject. No StringLike, no wildcards. */
    const githubPrincipal = (subjects: string[]) =>
      new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${OIDC_HOST}:sub`]: subjects,
        },
      });

    const cdkRole = (kind: string) =>
      `arn:aws:iam::${account}:role/cdk-hnb659fds-${kind}-role-${account}-${region}`;
    const stackArn = (stackName: string) =>
      `arn:aws:cloudformation:${region}:${account}:stack/${stackName}/*`;

    // Deploy role: environment jobs only (dev, prod). The main-only restriction is
    // enforced by the GitHub environments' deployment-branch policies.
    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: 'GitHubDeployRole',
      description: 'GitHub Actions deploy (environments dev and prod)',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: githubPrincipal([
        `repo:${GITHUB_REPO}:environment:dev`,
        `repo:${GITHUB_REPO}:environment:prod`,
      ]),
    });
    // No lookup role (ReadOnlyAccess reaches user data); context is committed.
    // No image-publishing role (no Docker assets).
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkRoles',
        actions: ['sts:AssumeRole'],
        resources: [cdkRole('deploy'), cdkRole('file-publishing')],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadProdTemplate',
        actions: ['cloudformation:GetTemplate', 'cloudformation:DescribeStacks'],
        resources: [stackArn('WordStudyToolStack')],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SeedDevStrongs',
        actions: ['dynamodb:GetItem', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:${region}:${account}:table/StrongsData-dev`],
      }),
    );

    // Diff role: pull_request jobs only. Read-only; no sts:AssumeRole at all.
    const diffRole = new iam.Role(this, 'GitHubDiffRole', {
      roleName: 'GitHubDiffRole',
      description: 'GitHub Actions read-only cdk diff on pull requests',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: githubPrincipal([`repo:${GITHUB_REPO}:pull_request`]),
    });
    diffRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStackTemplates',
        actions: [
          'cloudformation:GetTemplate',
          'cloudformation:DescribeStacks',
          'cloudformation:ListStackResources',
          'cloudformation:GetTemplateSummary',
        ],
        resources: [
          stackArn('WordStudyToolStack'),
          stackArn('WordStudyTool-Dev'),
          stackArn('PipelineBootstrapStack'),
        ],
      }),
    );
    diffRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadBootstrapVersion',
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${account}:parameter/cdk-bootstrap/hnb659fds/version`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'DiffRoleArn', { value: diffRole.roleArn });
  }
}
