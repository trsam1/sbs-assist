import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';
import { HOSTED_ZONE, StageConfig } from './stage-config';

export interface WordStudyToolStackProps extends cdk.StackProps {
  /** Per-stage settings (see stage-config.ts). */
  config: StageConfig;
  /** Directory containing the built Angular app (dist/word-study-tool/browser). */
  frontendAssetPath: string;
}

/**
 * The whole app for one stage. Construct IDs are identical across stages (except the
 * certificate) and prod physical names carry no suffix, so prod's identity is unchanged.
 * Never rename a construct ID or a stateful resource's physical name.
 */
export class WordStudyToolStack extends cdk.Stack {
  /** DynamoDB table for user word studies */
  public readonly wordStudiesTable: dynamodb.Table;

  /** DynamoDB table for pre-loaded Strong's concordance data */
  public readonly strongsDataTable: dynamodb.Table;

  /** DynamoDB table for user scroll studies (Step 4) */
  public readonly scrollStudiesTable: dynamodb.Table;

  /** S3 bucket for direct document uploads (transient; extracted text lives in DynamoDB) */
  public readonly uploadsBucket: s3.Bucket;

  /** REST API Gateway */
  public readonly api: apigateway.RestApi;

  /** S3 bucket for Angular static assets */
  public readonly siteBucket: s3.Bucket;

  /** CloudFront distribution */
  public readonly distribution: cloudfront.Distribution;

  /** Lambda: Strong's Lookup */
  public readonly strongsLookupFn: nodejs.NodejsFunction;

  /** Lambda: Study CRUD */
  public readonly studyCrudFn: nodejs.NodejsFunction;

  /** Lambda: AI Summary */
  public readonly aiSummaryFn: nodejs.NodejsFunction;

  /** Lambda: Scroll Study CRUD + presigned upload URL */
  public readonly scrollStudyFn: nodejs.NodejsFunction;

  /** Lambda: Extract Text (S3-triggered) */
  public readonly extractTextFn: nodejs.NodejsFunction;

  /** Cognito User Pool */
  public readonly userPool: cognito.UserPool;

  /** Cognito User Pool Client */
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: WordStudyToolStackProps) {
    super(scope, id, props);
    const { config } = props;

    /** Stage-specific physical name. Prod's suffix is '', so prod names are unchanged. */
    const n = (base: string) => `${base}${config.nameSuffix}`;
    const allowedOrigins = [`https://${config.siteDomain}`, ...config.extraAllowedOrigins];

    // -------------------------------------------------------
    // Custom Domain — Route 53 + ACM
    // -------------------------------------------------------

    const domainName = HOSTED_ZONE.zoneName;

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    // Prod keeps its existing wildcard cert; dev issues its own so it never depends on prod.
    const certificate =
      config.certificate === 'wildcard'
        ? new acm.Certificate(this, 'WildcardCert', {
            domainName: `*.${domainName}`,
            subjectAlternativeNames: [domainName],
            validation: acm.CertificateValidation.fromDns(hostedZone),
          })
        : new acm.Certificate(this, 'SiteCert', {
            domainName: config.siteDomain,
            validation: acm.CertificateValidation.fromDns(hostedZone),
          });

    // -------------------------------------------------------
    // DynamoDB Tables
    // -------------------------------------------------------

    this.wordStudiesTable = new dynamodb.Table(this, 'WordStudies', {
      tableName: n('WordStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.wordStudiesPitr },
    });

    this.wordStudiesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // No PITR: StrongsData is reference data and can be re-seeded.
    this.strongsDataTable = new dynamodb.Table(this, 'StrongsData', {
      tableName: n('StrongsData'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // Scroll studies (Step 4). Same key shape + GSI as WordStudies so CRUD mirrors it.
    this.scrollStudiesTable = new dynamodb.Table(this, 'ScrollStudies', {
      tableName: n('ScrollStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    this.scrollStudiesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -------------------------------------------------------
    // S3 Bucket for Angular static assets
    // -------------------------------------------------------

    // Holds only rebuildable assets, so DESTROY in every stage.
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -------------------------------------------------------
    // S3 Bucket for direct document uploads (scroll studies)
    // -------------------------------------------------------

    // Transient: a source file is only needed until extraction completes (the extracted
    // text lives in DynamoDB), so DESTROY + auto-delete in every stage and a 7-day expiry.
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedOrigins,
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -------------------------------------------------------
    // CloudFront Distribution
    // -------------------------------------------------------

    const oac = new cloudfront.S3OriginAccessControl(this, 'SiteOAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [config.siteDomain],
      certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // Route 53 alias records → CloudFront. Keyed by construct ID in stage config, so an
    // existing record's logical ID never changes (a rename would fail on the duplicate name).
    for (const [recordId, recordName] of Object.entries(config.aliasRecords)) {
      new route53.ARecord(this, recordId, {
        zone: hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
      });
    }

    // -------------------------------------------------------
    // API Gateway
    // -------------------------------------------------------

    this.api = new apigateway.RestApi(this, 'WordStudyApi', {
      restApiName: n('WordStudyApi'),
      description: 'Bible Word Study Tool API',
      // Prod owns the account-level API Gateway CloudWatch setting; dev must not create a second one.
      cloudWatchRole: config.apiCloudWatchRole,
      deployOptions: {
        stageName: config.apiStageName,
        throttlingBurstLimit: config.throttle.burstLimit,
        throttlingRateLimit: config.throttle.rateLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Usage plan with throttling
    const usagePlan = this.api.addUsagePlan('UsagePlan', {
      name: n('WordStudyUsagePlan'),
      throttle: {
        burstLimit: config.throttle.burstLimit,
        rateLimit: config.throttle.rateLimit,
      },
    });
    usagePlan.addApiStage({ stage: this.api.deploymentStage });

    // -------------------------------------------------------
    // Cognito User Pool
    // -------------------------------------------------------

    this.userPool = new cognito.UserPool(this, 'WordStudyUserPool', {
      userPoolName: n('WordStudyUserPool'),
      selfSignUpEnabled: config.selfSignUpEnabled,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.statefulRemovalPolicy,
    });

    this.userPoolClient = this.userPool.addClient('WordStudySpaClient', {
      userPoolClientName: 'WordStudySpaClient',
      authFlows: {
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      identitySource: 'method.request.header.Authorization',
    });

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // -------------------------------------------------------
    // Lambda Functions
    // -------------------------------------------------------

    const commonLambdaProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

    // Explicit log groups give each function a retention. CDK generates the names, so they
    // cannot collide with the legacy implicit /aws/lambda/<name> groups.
    const fnLogs = (fnId: string) =>
      new logs.LogGroup(this, `${fnId}Logs`, {
        retention: config.logRetention,
        removalPolicy: config.statefulRemovalPolicy,
      });

    const allowedOriginsEnv = allowedOrigins.join(',');

    // --- Strong's Lookup Lambda ---
    this.strongsLookupFn = new nodejs.NodejsFunction(this, 'StrongsLookupFn', {
      ...commonLambdaProps,
      functionName: n('StrongsLookup'),
      logGroup: fnLogs('StrongsLookupFn'),
      entry: path.join(__dirname, '..', 'lambda', 'strongs-lookup', 'index.ts'),
      handler: 'handler',
      environment: {
        STRONGS_TABLE_NAME: this.strongsDataTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.strongsDataTable.grantReadData(this.strongsLookupFn);

    // --- Study CRUD Lambda ---
    this.studyCrudFn = new nodejs.NodejsFunction(this, 'StudyCrudFn', {
      ...commonLambdaProps,
      functionName: n('StudyCRUD'),
      logGroup: fnLogs('StudyCrudFn'),
      entry: path.join(__dirname, '..', 'lambda', 'study-crud', 'index.ts'),
      handler: 'handler',
      environment: {
        WORD_STUDIES_TABLE_NAME: this.wordStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.wordStudiesTable.grantReadWriteData(this.studyCrudFn);

    // --- AI Summary Lambda ---
    this.aiSummaryFn = new nodejs.NodejsFunction(this, 'AISummaryFn', {
      ...commonLambdaProps,
      functionName: n('AISummary'),
      logGroup: fnLogs('AISummaryFn'),
      entry: path.join(__dirname, '..', 'lambda', 'ai-summary', 'index.ts'),
      handler: 'handler',
      environment: {
        WORD_STUDIES_TABLE_NAME: this.wordStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.wordStudiesTable.grantReadData(this.aiSummaryFn);

    this.aiSummaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      }),
    );

    // --- Scroll Study Lambda (CRUD + presigned upload URL) ---
    this.scrollStudyFn = new nodejs.NodejsFunction(this, 'ScrollStudyFn', {
      ...commonLambdaProps,
      functionName: n('ScrollStudy'),
      logGroup: fnLogs('ScrollStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'scroll-study', 'index.ts'),
      handler: 'handler',
      environment: {
        SCROLL_STUDIES_TABLE_NAME: this.scrollStudiesTable.tableName,
        UPLOADS_BUCKET_NAME: this.uploadsBucket.bucketName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.scrollStudiesTable.grantReadWriteData(this.scrollStudyFn);
    this.scrollStudyFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [this.uploadsBucket.arnForObjects('uploads/*')],
      }),
    );

    // --- Extract Text Lambda (S3-triggered; sole writer of post-upload status) ---
    // Heavier than the other handlers (PDF/Word parsing), so more memory and a longer timeout.
    this.extractTextFn = new nodejs.NodejsFunction(this, 'ExtractTextFn', {
      ...commonLambdaProps,
      functionName: n('ExtractText'),
      logGroup: fnLogs('ExtractTextFn'),
      entry: path.join(__dirname, '..', 'lambda', 'extract-text', 'index.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        SCROLL_STUDIES_TABLE_NAME: this.scrollStudiesTable.tableName,
      },
    });

    this.scrollStudiesTable.grantReadWriteData(this.extractTextFn);
    this.uploadsBucket.grantRead(this.extractTextFn);

    this.extractTextFn.addEventSource(
      new S3EventSource(this.uploadsBucket, {
        events: [s3.EventType.OBJECT_CREATED],
      }),
    );

    // -------------------------------------------------------
    // API Gateway Routes
    // -------------------------------------------------------

    const strongsLookupIntegration = new apigateway.LambdaIntegration(this.strongsLookupFn);

    // GET /strongs/{strongsNumber}
    const strongsResource = this.api.root.addResource('strongs').addResource('{strongsNumber}');
    strongsResource.addMethod('GET', strongsLookupIntegration);

    // GET /strongs/{strongsNumber}/cross-references
    const crossRefsResource = strongsResource.addResource('cross-references');
    crossRefsResource.addMethod('GET', strongsLookupIntegration);

    // --- Study CRUD routes ---
    const studyCrudIntegration = new apigateway.LambdaIntegration(this.studyCrudFn);

    const studiesResource = this.api.root.addResource('studies');

    // POST /studies
    studiesResource.addMethod('POST', studyCrudIntegration, authMethodOptions);

    // GET /studies
    studiesResource.addMethod('GET', studyCrudIntegration, authMethodOptions);

    const studyByIdResource = studiesResource.addResource('{studyId}');

    // GET /studies/{studyId}
    studyByIdResource.addMethod('GET', studyCrudIntegration, authMethodOptions);

    // DELETE /studies/{studyId}
    studyByIdResource.addMethod('DELETE', studyCrudIntegration, authMethodOptions);

    // --- AI Summary route ---
    const aiSummaryIntegration = new apigateway.LambdaIntegration(this.aiSummaryFn);

    const aiResource = this.api.root.addResource('ai');
    const studySummaryResource = aiResource.addResource('study-summary');

    // POST /ai/study-summary
    studySummaryResource.addMethod('POST', aiSummaryIntegration, authMethodOptions);

    // --- Scroll Study routes ---
    const scrollStudyIntegration = new apigateway.LambdaIntegration(this.scrollStudyFn);

    const scrollStudiesResource = this.api.root.addResource('scroll-studies');

    // POST /scroll-studies
    scrollStudiesResource.addMethod('POST', scrollStudyIntegration, authMethodOptions);

    // GET /scroll-studies
    scrollStudiesResource.addMethod('GET', scrollStudyIntegration, authMethodOptions);

    const scrollStudyByIdResource = scrollStudiesResource.addResource('{scrollStudyId}');

    // GET /scroll-studies/{scrollStudyId}
    scrollStudyByIdResource.addMethod('GET', scrollStudyIntegration, authMethodOptions);

    // DELETE /scroll-studies/{scrollStudyId}
    scrollStudyByIdResource.addMethod('DELETE', scrollStudyIntegration, authMethodOptions);

    // -------------------------------------------------------
    // Frontend deploy: built app + runtime /config.json
    // -------------------------------------------------------

    // Two deployments into one bucket give split cache headers. They share one singleton
    // handler (same memoryLimit) and one log group. prune is off on both, so neither can
    // delete the other's files, and old hashed chunks stay available to open tabs.
    const deployLogs = new logs.LogGroup(this, 'DeployLogs', {
      retention: config.logRetention,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // A local public/config.json never ships: the jsonData source is the only config.json.
    const siteSource = s3deploy.Source.asset(props.frontendAssetPath, { exclude: ['config.json'] });

    // Hashed chunks and media: immutable. Any new un-hashed file in public/ must be added to
    // this exclude list AND to the DeployShell include list.
    const assets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      destinationBucket: this.siteBucket,
      sources: [siteSource],
      exclude: ['index.html', 'config.json', 'favicon.ico'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      logGroup: deployLogs,
      memoryLimit: 256,
    });

    // Un-hashed shell files: no-cache. Deploys after the assets exist, then invalidates /*.
    const shell = new s3deploy.BucketDeployment(this, 'DeployShell', {
      destinationBucket: this.siteBucket,
      sources: [
        siteSource,
        s3deploy.Source.jsonData('config.json', {
          apiUrl: this.api.url,
          cognitoUserPoolId: this.userPool.userPoolId,
          cognitoUserPoolClientId: this.userPoolClient.userPoolClientId,
          cognitoRegion: this.region,
        }),
      ],
      exclude: ['*'],
      include: ['index.html', 'config.json', 'favicon.ico'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      logGroup: deployLogs,
      memoryLimit: 256,
    });
    shell.node.addDependency(assets);

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${config.siteDomain}`,
      description: 'Public site URL',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: this.siteBucket.bucketName,
      description: 'S3 bucket for static assets',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
  }
}
