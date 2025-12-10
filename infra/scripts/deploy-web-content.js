#!/usr/bin/env node

/**
 * Deploy Web Content Script
 *
 * This script uploads the Next.js build output to the S3 bucket
 * and invalidates the CloudFront distribution cache.
 *
 * Usage:
 *   node scripts/deploy-web-content.js
 *
 * Prerequisites:
 *   - Next.js app must be built (pnpm build in apps/web)
 *   - Web stack must be deployed (pnpm deploy:web)
 *   - AWS credentials must be configured
 */

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const {
  CloudFrontClient,
  CreateInvalidationCommand,
} = require('@aws-sdk/client-cloudfront');
const {
  CloudFormationClient,
  DescribeStacksCommand,
} = require('@aws-sdk/client-cloudformation');
const fs = require('fs');
const path = require('path');
const { lookup } = require('mime-types');

const STACK_NAME = 'DocIntelProWebStack';
const WEB_BUILD_DIR = path.join(__dirname, '../../apps/web/.next');
const WEB_OUT_DIR = path.join(__dirname, '../../apps/web/out');

async function getStackOutputs() {
  console.log(`📋 Getting outputs from stack: ${STACK_NAME}`);

  const cfnClient = new CloudFormationClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  try {
    const response = await cfnClient.send(
      new DescribeStacksCommand({ StackName: STACK_NAME }),
    );

    const stack = response.Stacks?.[0];
    if (!stack) {
      throw new Error(`Stack ${STACK_NAME} not found`);
    }

    const outputs = {};
    stack.Outputs?.forEach((output) => {
      outputs[output.OutputKey] = output.OutputValue;
    });

    return {
      bucketName: outputs.WebsiteBucketName,
      distributionId: outputs.DistributionId,
      websiteUrl: outputs.WebsiteURL,
    };
  } catch (error) {
    console.error('❌ Error getting stack outputs:', error.message);
    console.error('Make sure the web stack is deployed: pnpm deploy:web');
    process.exit(1);
  }
}

async function uploadDirectory(s3Client, bucketName, dirPath, prefix = '') {
  console.log(`📤 Uploading directory: ${dirPath}`);

  const files = [];

  function scanDir(dir, currentPrefix) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scanDir(fullPath, path.join(currentPrefix, item));
      } else {
        const key = path.join(currentPrefix, item).replace(/\\/g, '/');
        files.push({ fullPath, key });
      }
    }
  }

  scanDir(dirPath, prefix);

  console.log(`📦 Found ${files.length} files to upload`);

  let uploaded = 0;
  const errors = [];

  for (const { fullPath, key } of files) {
    try {
      const fileContent = fs.readFileSync(fullPath);
      const contentType = lookup(fullPath) || 'application/octet-stream';

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: fileContent,
          ContentType: contentType,
          CacheControl: key.startsWith('_next/static/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate',
        }),
      );

      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`   ✓ Uploaded ${uploaded}/${files.length} files...`);
      }
    } catch (error) {
      errors.push({ key, error: error.message });
      console.error(`   ✗ Failed to upload ${key}: ${error.message}`);
    }
  }

  console.log(`✅ Upload complete: ${uploaded}/${files.length} files uploaded`);

  if (errors.length > 0) {
    console.warn(`⚠️  ${errors.length} files failed to upload`);
  }

  return { uploaded, failed: errors.length, total: files.length };
}

async function invalidateCloudFront(cloudfrontClient, distributionId) {
  console.log(`🔄 Invalidating CloudFront distribution: ${distributionId}`);

  try {
    const response = await cloudfrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `deploy-${Date.now()}`,
          Paths: {
            Quantity: 1,
            Items: ['/*'],
          },
        },
      }),
    );

    console.log(`✅ Invalidation created: ${response.Invalidation?.Id}`);
    console.log('   ⏳ Cache invalidation may take 1-5 minutes to complete');
  } catch (error) {
    console.error('❌ Error creating invalidation:', error.message);
    throw error;
  }
}

async function checkBuildOutput() {
  // Check if Next.js was built with static export
  if (fs.existsSync(WEB_OUT_DIR)) {
    console.log('✅ Found static export in /out directory');
    return WEB_OUT_DIR;
  }

  // Check if standard Next.js build exists
  if (fs.existsSync(WEB_BUILD_DIR)) {
    console.log('✅ Found Next.js build in /.next directory');
    return WEB_BUILD_DIR;
  }

  console.error('❌ No build output found!');
  console.error('Please run: cd apps/web && pnpm build');
  process.exit(1);
}

async function main() {
  console.log('🚀 DocIntel Pro - Web Content Deployment\n');

  // Check build output
  const buildDir = await checkBuildOutput();

  // Get stack outputs
  const { bucketName, distributionId, websiteUrl } = await getStackOutputs();

  console.log(`\n📝 Deployment Configuration:`);
  console.log(`   S3 Bucket: ${bucketName}`);
  console.log(`   Distribution: ${distributionId}`);
  console.log(`   Website URL: ${websiteUrl}\n`);

  // Initialize AWS clients
  const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  const cloudfrontClient = new CloudFrontClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  // Upload files
  const stats = await uploadDirectory(s3Client, bucketName, buildDir);

  // Invalidate CloudFront cache
  await invalidateCloudFront(cloudfrontClient, distributionId);

  console.log(`\n✨ Deployment Complete!`);
  console.log(`\n🌐 Visit your website: ${websiteUrl}`);
  console.log(`\n📊 Statistics:`);
  console.log(`   - Total files: ${stats.total}`);
  console.log(`   - Uploaded: ${stats.uploaded}`);
  console.log(`   - Failed: ${stats.failed}`);
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Deployment failed:', error);
  process.exit(1);
});
