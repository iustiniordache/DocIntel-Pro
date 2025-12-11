#!/usr/bin/env node

/**
 * Standalone CDK Bootstrap Script
 * This script bootstraps CDK without requiring any app stacks to be synthesized
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

    // Create a temporary directory for bootstrap
    const tempDir = path.join(__dirname, '../.bootstrap-temp');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Create minimal cdk.json
    const cdkJson = {
      app: 'echo "{}"',
      context: {},
    };
    fs.writeFileSync(path.join(tempDir, 'cdk.json'), JSON.stringify(cdkJson, null, 2));

    console.log('Created temporary bootstrap directory\n');

    // Run bootstrap from temp directory
    const bootstrapCmd = `npx --yes cdk@latest bootstrap aws://${accountId}/${REGION} --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess`;

    console.log(`Running: ${bootstrapCmd}\n`);

    execSync(bootstrapCmd, {
      stdio: 'inherit',
      cwd: tempDir,
      env: { ...process.env },
    });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('\n✅ CDK Bootstrap completed successfully!');
  } catch (error) {
    console.error('\n❌ Bootstrap failed:', error.message);
    process.exit(1);
  }
}

main();
