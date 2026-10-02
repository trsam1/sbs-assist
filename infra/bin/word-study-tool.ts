#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { WordStudyToolStack } from '../lib/word-study-tool-stack';
import { STAGES } from '../lib/stage-config';
import { PipelineBootstrapStack } from '../lib/pipeline-bootstrap-stack';

// Hardcoded (not secret; already in cdk.context.json). CI verify has no credentials, so
// CDK_DEFAULT_ACCOUNT would be undefined and the hosted-zone lookup would fail.
const ACCOUNT = '224670540244';
const REGION = 'us-east-1';
const env = { account: ACCOUNT, region: REGION };

/** The built Angular app, or the placeholder site when explicitly allowed (destroy-dev only). */
function frontendAssetPath(): string {
  const dist = path.resolve(__dirname, '../../dist/word-study-tool/browser');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  if (process.env['CDK_ALLOW_PLACEHOLDER_SITE'] === '1') {
    return path.resolve(__dirname, '../test/fixtures/site');
  }
  throw new Error(`Frontend build not found at ${dist}. Run "npm run build" at the repo root first.`);
}

const app = new cdk.App();
const siteDir = frontendAssetPath();

// Prod: stack ID frozen.
new WordStudyToolStack(app, STAGES.prod.stackId, { env, config: STAGES.prod, frontendAssetPath: siteDir });
new WordStudyToolStack(app, STAGES.dev.stackId, { env, config: STAGES.dev, frontendAssetPath: siteDir });
// Deployed only by the user, locally. Never by CI.
new PipelineBootstrapStack(app, 'PipelineBootstrapStack', { env });
