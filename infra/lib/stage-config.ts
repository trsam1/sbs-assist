import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

/**
 * Per-stage settings. This is the ONLY place stage-specific values live.
 *
 * Prod identity is frozen: stack ID, construct IDs, and physical names must not change
 * (renaming a table, user pool, or record would replace it). Do not edit prod values
 * without an explicit request.
 */
export type Stage = 'dev' | 'prod';

export interface StageConfig {
  stage: Stage;
  /** CloudFormation stack ID. */
  stackId: string;
  /** FQDN served by CloudFront (first CORS origin, SiteUrl output). */
  siteDomain: string;
  /**
   * Route 53 alias records, keyed by construct ID → hostname. A record's construct ID
   * must never change once deployed (that would recreate the record and fail on the
   * duplicate name), so new hostnames get new IDs.
   */
  aliasRecords: Record<string, string>;
  /** CORS origins beyond https://<siteDomain>. */
  extraAllowedOrigins: string[];
  /** Appended to physical resource names ('' keeps prod names unchanged). */
  nameSuffix: string;
  /** Removal policy for tables, user pool, and log groups. */
  statefulRemovalPolicy: RemovalPolicy;
  /** Point-in-time recovery on the WordStudies table. */
  wordStudiesPitr: boolean;
  logRetention: RetentionDays;
  selfSignUpEnabled: boolean;
  apiStageName: string;
  throttle: { rateLimit: number; burstLimit: number };
  /** 'wildcard' keeps prod's existing *.teksnextdoor.com cert; 'site' issues one for siteDomain. */
  certificate: 'wildcard' | 'site';
  /** RestApi cloudWatchRole: owns the account-level API Gateway CloudWatch setting (prod only). */
  apiCloudWatchRole: boolean;
}

export const HOSTED_ZONE = { zoneName: 'teksnextdoor.com' } as const;

export const STAGES: Record<Stage, StageConfig> = {
  prod: {
    stage: 'prod',
    stackId: 'WordStudyToolStack',
    siteDomain: 'wordstudy.teksnextdoor.com',
    aliasRecords: { SiteAliasRecord: 'wordstudy.teksnextdoor.com' },
    extraAllowedOrigins: [],
    nameSuffix: '',
    statefulRemovalPolicy: RemovalPolicy.RETAIN,
    wordStudiesPitr: true,
    logRetention: RetentionDays.THREE_MONTHS,
    selfSignUpEnabled: true,
    apiStageName: 'prod',
    throttle: { rateLimit: 50, burstLimit: 100 },
    certificate: 'wildcard',
    apiCloudWatchRole: true,
  },
  dev: {
    stage: 'dev',
    stackId: 'WordStudyTool-Dev',
    siteDomain: 'axiostools-dev.teksnextdoor.com',
    aliasRecords: { SiteAliasRecord: 'axiostools-dev.teksnextdoor.com' },
    extraAllowedOrigins: ['http://localhost:4200'],
    nameSuffix: '-dev',
    statefulRemovalPolicy: RemovalPolicy.DESTROY,
    wordStudiesPitr: false,
    logRetention: RetentionDays.ONE_WEEK,
    selfSignUpEnabled: false,
    apiStageName: 'dev',
    throttle: { rateLimit: 5, burstLimit: 10 },
    certificate: 'site',
    apiCloudWatchRole: false,
  },
};
