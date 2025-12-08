#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DocIntelProApiStack } from '../lib/api-stack';
import { DocIntelProStorageStack } from '../lib/storage-stack';

// Load environment variables from .env.development
config({ path: resolve(__dirname, '../../.env.development') });

const app = new cdk.App();

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] || process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
};

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

app.synth();
