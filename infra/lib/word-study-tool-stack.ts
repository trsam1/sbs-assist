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

  /** DynamoDB table for user book studies */
  public readonly bookStudiesTable: dynamodb.Table;

  /** Lambda: Book Study CRUD */
  public readonly bookStudyCrudFn: nodejs.NodejsFunction;

  /** Lambda: AI Summary */
  public readonly aiSummaryFn: nodejs.NodejsFunction;

  /** Lambda: Scroll Study CRUD + presigned upload URL */
  public readonly scrollStudyFn: nodejs.NodejsFunction;

  /** DynamoDB table for user antecedent studies (Step 6) */
  public readonly antecedentStudiesTable: dynamodb.Table;

  /** Lambda: Antecedent Study CRUD */
  public readonly antecedentStudyFn: nodejs.NodejsFunction;

  /** DynamoDB table for user structure studies (Step 7) */
  public readonly structureStudiesTable: dynamodb.Table;

  /** Lambda: Structure Study CRUD */
  public readonly structureStudyFn: nodejs.NodejsFunction;

  /** DynamoDB table for user outline studies (Step 8) */
  public readonly outlineStudiesTable: dynamodb.Table;

  /** Lambda: Outline Study CRUD */
  public readonly outlineStudyFn: nodejs.NodejsFunction;

  /** DynamoDB table for user figures studies (Step 10) */
  public readonly figuresStudiesTable: dynamodb.Table;

  /** Lambda: Figures Study CRUD */
  public readonly figuresStudyFn: nodejs.NodejsFunction;

  /** Lambda: Figures Assist (Bedrock; Step 10 candidates + tag-check) */
  public readonly figuresAssistFn: nodejs.NodejsFunction;

  /** DynamoDB: Interrogation Studies (Step 12 — Interrogate the Text) */
  public readonly interrogationStudiesTable: dynamodb.Table;

  /** Lambda: Interrogation Study CRUD */
  public readonly interrogationStudyFn: nodejs.NodejsFunction;

  /** DynamoDB: Memorization Studies (Memorize the Scroll companion) */
  public readonly memorizationStudiesTable: dynamodb.Table;

  /** Lambda: Memorization Study CRUD */
  public readonly memorizationStudyFn: nodejs.NodejsFunction;

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

    // Book studies: same layout as WordStudies, but no PITR (small, easily recreated
    // containers; omitting it keeps "PITR on WordStudies only" true and adds no StageConfig field).
    this.bookStudiesTable = new dynamodb.Table(this, 'BookStudies', {
      tableName: n('BookStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    this.bookStudiesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Antecedent studies (Step 6). One record per scroll per user, fetched by exact key, so no
    // GSI is needed (and no PITR, consistent with BookStudies — no new StageConfig field).
    this.antecedentStudiesTable = new dynamodb.Table(this, 'AntecedentStudies', {
      tableName: n('AntecedentStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // Structure studies (Step 7). One record per scroll per user, fetched by exact key, so no
    // GSI is needed (and no PITR, consistent with AntecedentStudies — no new StageConfig field).
    this.structureStudiesTable = new dynamodb.Table(this, 'StructureStudies', {
      tableName: n('StructureStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // Outline studies (Step 8). One record per scroll per user, fetched by exact key, so no
    // GSI is needed (and no PITR, consistent with StructureStudies — no new StageConfig field).
    this.outlineStudiesTable = new dynamodb.Table(this, 'OutlineStudies', {
      tableName: n('OutlineStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // Figures studies (Step 10). One record per scroll per user, fetched by exact key, so no
    // GSI is needed (and no PITR, consistent with the sibling study tables — the one new
    // StageConfig field, figuresAssistModelId, is a model-id string, not a table property).
    this.figuresStudiesTable = new dynamodb.Table(this, 'FiguresStudies', {
      tableName: n('FiguresStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    // Step 12 — Interrogate the Text: one Q&A worksheet per scroll per user. Additive,
    // same layout as the sibling study tables (no GSI, no PITR, stage removal policy).
    this.interrogationStudiesTable = new dynamodb.Table(this, 'InterrogationStudies', {
      tableName: n('InterrogationStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
    });

    this.memorizationStudiesTable = new dynamodb.Table(this, 'MemorizationStudies', {
      tableName: n('MemorizationStudies'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.statefulRemovalPolicy,
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

    // --- Book Study CRUD Lambda ---
    this.bookStudyCrudFn = new nodejs.NodejsFunction(this, 'BookStudyCrudFn', {
      ...commonLambdaProps,
      functionName: n('BookStudyCRUD'),
      logGroup: fnLogs('BookStudyCrudFn'),
      entry: path.join(__dirname, '..', 'lambda', 'book-study-crud', 'index.ts'),
      handler: 'handler',
      environment: {
        BOOK_STUDIES_TABLE_NAME: this.bookStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.bookStudiesTable.grantReadWriteData(this.bookStudyCrudFn);

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
        BOOK_STUDIES_TABLE_NAME: this.bookStudiesTable.tableName,
        UPLOADS_BUCKET_NAME: this.uploadsBucket.bucketName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.scrollStudiesTable.grantReadWriteData(this.scrollStudyFn);
    // Read-only on BookStudies to validate the bookStudyId link on scroll creation.
    this.bookStudiesTable.grantReadData(this.scrollStudyFn);
    this.scrollStudyFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [this.uploadsBucket.arnForObjects('uploads/*')],
      }),
    );

    // --- Antecedent Study CRUD Lambda (Step 6) ---
    this.antecedentStudyFn = new nodejs.NodejsFunction(this, 'AntecedentStudyFn', {
      ...commonLambdaProps,
      functionName: n('AntecedentStudy'),
      logGroup: fnLogs('AntecedentStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'antecedent-study', 'index.ts'),
      handler: 'handler',
      environment: {
        ANTECEDENT_STUDIES_TABLE_NAME: this.antecedentStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.antecedentStudiesTable.grantReadWriteData(this.antecedentStudyFn);

    // --- Structure Study CRUD Lambda (Step 7) ---
    this.structureStudyFn = new nodejs.NodejsFunction(this, 'StructureStudyFn', {
      ...commonLambdaProps,
      functionName: n('StructureStudy'),
      logGroup: fnLogs('StructureStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'structure-study', 'index.ts'),
      handler: 'handler',
      environment: {
        STRUCTURE_STUDIES_TABLE_NAME: this.structureStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.structureStudiesTable.grantReadWriteData(this.structureStudyFn);

    // --- Outline Study CRUD Lambda (Step 8) ---
    this.outlineStudyFn = new nodejs.NodejsFunction(this, 'OutlineStudyFn', {
      ...commonLambdaProps,
      functionName: n('OutlineStudy'),
      logGroup: fnLogs('OutlineStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'outline-study', 'index.ts'),
      handler: 'handler',
      environment: {
        OUTLINE_STUDIES_TABLE_NAME: this.outlineStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.outlineStudiesTable.grantReadWriteData(this.outlineStudyFn);

    // --- Figures Study CRUD Lambda (Step 10) ---
    this.figuresStudyFn = new nodejs.NodejsFunction(this, 'FiguresStudyFn', {
      ...commonLambdaProps,
      functionName: n('FiguresStudy'),
      logGroup: fnLogs('FiguresStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'figures-study', 'index.ts'),
      handler: 'handler',
      environment: {
        FIGURES_STUDIES_TABLE_NAME: this.figuresStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.figuresStudiesTable.grantReadWriteData(this.figuresStudyFn);

    // --- Figures Assist Lambda (Step 10; Bedrock candidate scan + tag-check) ---
    // The assist model is per-stage (prod Opus 5.5, dev Sonnet 5.5) via config.figuresAssistModelId.
    // The IAM grant is derived from that same id so model and grant never drift. The id is the full
    // cross-Region inference profile (e.g. 'us.anthropic.claude-opus-5-5'); the foundation-model ARN
    // drops the regional prefix, the inference-profile ARN keeps the id as configured.
    const assistModelId = config.figuresAssistModelId;
    const foundationModelId = assistModelId.replace(/^(us|eu|apac|global)\./, '');
    this.figuresAssistFn = new nodejs.NodejsFunction(this, 'FiguresAssistFn', {
      ...commonLambdaProps,
      functionName: n('FiguresAssist'),
      logGroup: fnLogs('FiguresAssistFn'),
      entry: path.join(__dirname, '..', 'lambda', 'figures-assist', 'index.ts'),
      handler: 'handler',
      environment: {
        FIGURES_ASSIST_MODEL_ID: assistModelId,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.figuresAssistFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/${foundationModelId}`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${assistModelId}`,
        ],
      }),
    );

    // --- Interrogation Study Lambda (Step 12; CRUD only, no Bedrock) ---
    this.interrogationStudyFn = new nodejs.NodejsFunction(this, 'InterrogationStudyFn', {
      ...commonLambdaProps,
      functionName: n('InterrogationStudy'),
      logGroup: fnLogs('InterrogationStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'interrogation-study', 'index.ts'),
      handler: 'handler',
      environment: {
        INTERROGATION_STUDIES_TABLE_NAME: this.interrogationStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.interrogationStudiesTable.grantReadWriteData(this.interrogationStudyFn);

    this.memorizationStudyFn = new nodejs.NodejsFunction(this, 'MemorizationStudyFn', {
      ...commonLambdaProps,
      functionName: n('MemorizationStudy'),
      logGroup: fnLogs('MemorizationStudyFn'),
      entry: path.join(__dirname, '..', 'lambda', 'memorization-study', 'index.ts'),
      handler: 'handler',
      environment: {
        MEMORIZATION_STUDIES_TABLE_NAME: this.memorizationStudiesTable.tableName,
        ALLOWED_ORIGINS: allowedOriginsEnv,
      },
    });

    this.memorizationStudiesTable.grantReadWriteData(this.memorizationStudyFn);

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

    // --- Book Study CRUD routes ---
    const bookStudyCrudIntegration = new apigateway.LambdaIntegration(this.bookStudyCrudFn);

    const booksResource = this.api.root.addResource('books');

    // POST /books
    booksResource.addMethod('POST', bookStudyCrudIntegration, authMethodOptions);

    // GET /books
    booksResource.addMethod('GET', bookStudyCrudIntegration, authMethodOptions);

    const bookByIdResource = booksResource.addResource('{bookStudyId}');

    // GET /books/{bookStudyId}
    bookByIdResource.addMethod('GET', bookStudyCrudIntegration, authMethodOptions);

    // DELETE /books/{bookStudyId}
    bookByIdResource.addMethod('DELETE', bookStudyCrudIntegration, authMethodOptions);

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

    // --- Antecedent Study routes (nested under a scroll study) ---
    const antecedentStudyIntegration = new apigateway.LambdaIntegration(this.antecedentStudyFn);

    const antecedentsResource = scrollStudyByIdResource.addResource('antecedents');

    // GET /scroll-studies/{scrollStudyId}/antecedents
    antecedentsResource.addMethod('GET', antecedentStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/antecedents
    antecedentsResource.addMethod('PUT', antecedentStudyIntegration, authMethodOptions);

    // --- Structure Study routes (nested under a scroll study, Step 7) ---
    const structureStudyIntegration = new apigateway.LambdaIntegration(this.structureStudyFn);

    const structureResource = scrollStudyByIdResource.addResource('structure');

    // GET /scroll-studies/{scrollStudyId}/structure
    structureResource.addMethod('GET', structureStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/structure
    structureResource.addMethod('PUT', structureStudyIntegration, authMethodOptions);

    // --- Outline Study routes (nested under a scroll study, Step 8) ---
    const outlineStudyIntegration = new apigateway.LambdaIntegration(this.outlineStudyFn);

    const outlineResource = scrollStudyByIdResource.addResource('outline');

    // GET /scroll-studies/{scrollStudyId}/outline
    outlineResource.addMethod('GET', outlineStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/outline
    outlineResource.addMethod('PUT', outlineStudyIntegration, authMethodOptions);

    // --- Figures Study routes (nested under a scroll study, Step 10) ---
    const figuresStudyIntegration = new apigateway.LambdaIntegration(this.figuresStudyFn);

    const figuresResource = scrollStudyByIdResource.addResource('figures');

    // GET /scroll-studies/{scrollStudyId}/figures
    figuresResource.addMethod('GET', figuresStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/figures
    figuresResource.addMethod('PUT', figuresStudyIntegration, authMethodOptions);

    // --- Figures Assist route (Bedrock; Step 10 candidates + tag-check) ---
    const figuresAssistIntegration = new apigateway.LambdaIntegration(this.figuresAssistFn);

    const figuresAssistResource = aiResource.addResource('figures-assist');

    // POST /ai/figures-assist
    figuresAssistResource.addMethod('POST', figuresAssistIntegration, authMethodOptions);

    // --- Interrogation Study routes (Step 12; CRUD) ---
    const interrogationStudyIntegration = new apigateway.LambdaIntegration(
      this.interrogationStudyFn,
    );

    const interrogateResource = scrollStudyByIdResource.addResource('interrogate');

    // GET /scroll-studies/{scrollStudyId}/interrogate
    interrogateResource.addMethod('GET', interrogationStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/interrogate
    interrogateResource.addMethod('PUT', interrogationStudyIntegration, authMethodOptions);

    // --- Memorization Study routes (Memorize the Scroll companion; CRUD) ---
    const memorizationStudyIntegration = new apigateway.LambdaIntegration(this.memorizationStudyFn);

    const memorizeResource = scrollStudyByIdResource.addResource('memorize');

    // GET /scroll-studies/{scrollStudyId}/memorize
    memorizeResource.addMethod('GET', memorizationStudyIntegration, authMethodOptions);

    // PUT /scroll-studies/{scrollStudyId}/memorize
    memorizeResource.addMethod('PUT', memorizationStudyIntegration, authMethodOptions);

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
