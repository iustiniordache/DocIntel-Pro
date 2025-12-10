#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DocIntelProApiStack } from '../lib/api-stack';
import { DocIntelProStorageStack } from '../lib/storage-stack';
import { DocIntelProWebStack } from '../lib/web-stack';
import { MinimalStack } from '../stacks/minimal-stack';

// Load environment variables from .env.development
config({ path: resolve(__dirname, '../../.env.development') });

const app = new cdk.App();

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] || process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
};

// MINIMAL STACK (fast deploy)
const minimalStack = new MinimalStack(app, 'MinimalStack', {
  env,
  description: 'DocIntel Pro - Minimal deployment (Upload + TextractStart only)',
  tags: {
    AppManagerCFNStackKey: 'MinimalStack',
  },
});

// Storage Stack (S3, DynamoDB)
const storageStack = new DocIntelProStorageStack(app, 'DocIntelProStorageStack', {
  env,
  description: 'DocIntel Pro - Storage infrastructure (S3, DynamoDB)',
});

// API Stack (Lambda, API Gateway)
new DocIntelProApiStack(app, 'DocIntelProApiStack', {
  env,
  description: 'DocIntel Pro - API infrastructure (Lambda, API Gateway)',
  documentsBucket: storageStack.documentsBucket,
});

// Web Stack (CloudFront, S3 for static website)
// Pass API URL from MinimalStack for NEXT_PUBLIC_API_URL
new DocIntelProWebStack(app, 'DocIntelProWebStack', {
  env,
  description: 'DocIntel Pro - Web frontend (CloudFront, S3)',
  apiUrl: minimalStack.apiUrl,
});

app.synth();
