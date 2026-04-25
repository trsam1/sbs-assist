import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as path from 'path';
import { Construct } from 'constructs';

export class WordStudyToolStack extends cdk.Stack {
  /** DynamoDB table for user word studies */
  public readonly wordStudiesTable: dynamodb.Table;
  /** DynamoDB table for pre-loaded Strong's concordance data */
  public readonly strongsDataTable: dynamodb.Table;
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
  /** Cognito User Pool */
  public readonly userPool: cognito.UserPool;
  /** Cognito User Pool Client */
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------
    // Custom Domain — Route 53 + ACM
    // -------------------------------------------------------

    const domainName = 'teksnextdoor.com';
    const appSubdomain = `wordstudy.${domainName}`;

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    const certificate = new acm.Certificate(this, 'WildcardCert', {
      domainName: `*.${domainName}`,
      subjectAlternativeNames: [domainName],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // -------------------------------------------------------
    // DynamoDB Tables
    // -------------------------------------------------------

    this.wordStudiesTable = new dynamodb.Table(this, 'WordStudies', {
      tableName: 'WordStudies',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.wordStudiesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.strongsDataTable = new dynamodb.Table(this, 'StrongsData', {
      tableName: 'StrongsData',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------
    // S3 Bucket for Angular static assets
    // -------------------------------------------------------

    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
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
      domainNames: [appSubdomain],
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

    // Route 53 alias record: wordstudy.teksnextdoor.com → CloudFront
    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: appSubdomain,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });

    // -------------------------------------------------------
    // API Gateway
    // -------------------------------------------------------

    this.api = new apigateway.RestApi(this, 'WordStudyApi', {
      restApiName: 'WordStudyApi',
      description: 'Bible Word Study Tool API',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [`https://${appSubdomain}`],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Usage plan with throttling
    const usagePlan = this.api.addUsagePlan('UsagePlan', {
      name: 'WordStudyUsagePlan',
      throttle: {
        burstLimit: 100,
        rateLimit: 50,
      },
    });

    usagePlan.addApiStage({ stage: this.api.deploymentStage });

    // -------------------------------------------------------
    // Cognito User Pool
    // -------------------------------------------------------

    this.userPool = new cognito.UserPool(this, 'WordStudyUserPool', {
      userPoolName: 'WordStudyUserPool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

    // --- Strong's Lookup Lambda ---
    const allowedOrigin = `https://${appSubdomain}`;

    this.strongsLookupFn = new nodejs.NodejsFunction(this, 'StrongsLookupFn', {
      ...commonLambdaProps,
      functionName: 'StrongsLookup',
      entry: path.join(__dirname, '..', 'lambda', 'strongs-lookup', 'index.ts'),
      handler: 'handler',
      environment: {
        STRONGS_TABLE_NAME: this.strongsDataTable.tableName,
        ALLOWED_ORIGIN: allowedOrigin,
      },
    });

    this.strongsDataTable.grantReadData(this.strongsLookupFn);

    // --- Study CRUD Lambda ---
    this.studyCrudFn = new nodejs.NodejsFunction(this, 'StudyCrudFn', {
      ...commonLambdaProps,
      functionName: 'StudyCRUD',
      entry: path.join(__dirname, '..', 'lambda', 'study-crud', 'index.ts'),
      handler: 'handler',
      environment: {
        WORD_STUDIES_TABLE_NAME: this.wordStudiesTable.tableName,
        ALLOWED_ORIGIN: allowedOrigin,
      },
    });

    this.wordStudiesTable.grantReadWriteData(this.studyCrudFn);

    // --- AI Summary Lambda ---
    this.aiSummaryFn = new nodejs.NodejsFunction(this, 'AISummaryFn', {
      ...commonLambdaProps,
      functionName: 'AISummary',
      entry: path.join(__dirname, '..', 'lambda', 'ai-summary', 'index.ts'),
      handler: 'handler',
      environment: {
        WORD_STUDIES_TABLE_NAME: this.wordStudiesTable.tableName,
        ALLOWED_ORIGIN: allowedOrigin,
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

    // -------------------------------------------------------
    // API Gateway Routes
    // -------------------------------------------------------

    const strongsLookupIntegration = new apigateway.LambdaIntegration(this.strongsLookupFn);

    // GET /strongs/{strongsNumber}
    const strongsResource = this.api.root
      .addResource('strongs')
      .addResource('{strongsNumber}');
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

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

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
