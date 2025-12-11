#!/usr/bin/env node

/**
 * Standalone CDK Bootstrap Script
 * This script bootstraps CDK without requiring any app stacks to be synthesized
 */

const { execSync } = require('child_process');

const REGION = process.env.AWS_REGION || 'us-east-1';

async function main() {
  console.log('🚀 Starting CDK Bootstrap...\n');

  try {
    // Get AWS account ID
    const accountId = execSync('aws sts get-caller-identity --query Account --output text', {
      encoding: 'utf-8',
    }).trim();

    console.log(`Account ID: ${accountId}`);
    console.log(`Region: ${REGION}\n`);

    // Run bootstrap
    const bootstrapCmd = `npx --yes cdk@latest bootstrap aws://${accountId}/${REGION} --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess`;

    console.log(`Running: ${bootstrapCmd}\n`);

    execSync(bootstrapCmd, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    console.log('\n✅ CDK Bootstrap completed successfully!');
  } catch (error) {
    console.error('\n❌ Bootstrap failed:', error.message);
    process.exit(1);
  }
}

main();
