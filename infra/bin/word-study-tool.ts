#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WordStudyToolStack } from '../lib/word-study-tool-stack';

const app = new cdk.App();
new WordStudyToolStack(app, 'WordStudyToolStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
});
