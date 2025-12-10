import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface WebStackProps extends cdk.StackProps {
  apiUrl?: string;
}

export class DocIntelProWebStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: WebStackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. S3 BUCKET for Static Website
    // ==========================================
    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `docintel-web-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Dev only - change for production
      autoDeleteObjects: true, // Dev only - change for production
      versioned: false,
    });

    // ==========================================
    // 2. CloudFront Origin Access Identity
    // ==========================================
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'WebsiteOAI', {
      comment: 'OAI for DocIntel Pro Web',
    });

    // Grant CloudFront read access to S3 bucket
    this.websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.websiteBucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    );

    // ==========================================
    // 3. CloudFront Distribution
    // ==========================================
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecurityHeadersPolicy',
      {
        responseHeadersPolicyName: `DocIntel-Web-Security-Headers-${this.region}`,
        comment: 'Security headers for DocIntel Pro Web',
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(63072000),
            includeSubdomains: true,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
        },
        customHeadersBehavior: {
          customHeaders: [
            {
              header: 'Cache-Control',
              value: 'no-cache, no-store, must-revalidate',
              override: true,
            },
            {
              header: 'Pragma',
              value: 'no-cache',
              override: true,
            },
            {
              header: 'Expires',
              value: '0',
              override: true,
            },
          ],
        },
      },
    );

    // CloudFront Function for SPA routing
    const rewriteFunction = new cloudfront.Function(this, 'RewriteFunction', {
      functionName: `DocIntel-Web-Rewrite-${this.region}`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Check if the URI is missing a file extension
    if (!uri.includes('.')) {
        request.uri = '/index.html';
    }
    
    return request;
}
      `),
      comment: 'Rewrite requests to index.html for SPA routing',
    });

    this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      comment: 'DocIntel Pro Web Distribution',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(this.websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        responseHeadersPolicy,
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: new origins.S3Origin(this.websiteBucket, {
            originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: new cloudfront.CachePolicy(this, 'NextStaticCachePolicy', {
            cachePolicyName: `DocIntel-NextStatic-${this.region}`,
            comment: 'Cache policy for Next.js static assets',
            defaultTtl: cdk.Duration.days(365),
            maxTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.days(365),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // ==========================================
    // 4. Deploy Website Content (placeholder)
    // ==========================================
    // Note: Initial deployment with empty bucket
    // Run 'pnpm deploy:web' after building the Next.js app
    // to deploy actual content

    // ==========================================
    // 5. Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: this.websiteBucket.bucketName,
      description: 'S3 bucket name for website content',
      exportName: 'DocIntelWebBucketName',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: 'DocIntelDistributionId',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
      exportName: 'DocIntelDistributionDomain',
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Website URL',
      exportName: 'DocIntelWebsiteURL',
    });

    // Output API URL for reference
    if (props?.apiUrl) {
      new cdk.CfnOutput(this, 'ApiURL', {
        value: props.apiUrl,
        description: 'API Gateway URL to configure in Next.js',
      });
    }
  }
}
