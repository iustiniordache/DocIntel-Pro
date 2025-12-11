import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

export class MinimalStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. S3 BUCKET (documents)
    // ==========================================
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `docintel-documents-minimal-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Dev only
      autoDeleteObjects: true, // Dev only
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://localhost:3000',
            'https://*.cloudfront.net',
            // Add production domain when ready
            // 'https://your-domain.com'
          ],
          allowedHeaders: ['*'],
          exposedHeaders: [
            'ETag',
            'x-amz-server-side-encryption',
            'x-amz-request-id',
            'x-amz-id-2',
          ],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'DeleteAfter7Days',
          enabled: true,
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    // ==========================================
    // 2. DYNAMODB TABLES (2)
    // ==========================================
    const metadataTable = new dynamodb.Table(this, 'DocumentMetadataTable', {
      tableName: 'DocIntel-DocumentMetadata',
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Dev only
      pointInTimeRecovery: false, // Dev only (enable for prod)
    });

    const jobsTable = new dynamodb.Table(this, 'ProcessingJobsTable', {
      tableName: 'DocIntel-ProcessingJobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Dev only
      pointInTimeRecovery: false, // Dev only (enable for prod)
    });

    // GSI for looking up jobs by Textract JobId
    jobsTable.addGlobalSecondaryIndex({
      indexName: 'TextractJobIdIndex',
      partitionKey: { name: 'textractJobId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // 3. SNS TOPIC (Textract completion notifications)
    // ==========================================
    const textractCompletionTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      topicName: 'DocIntel-TextractCompletion',
      displayName: 'Textract Job Completion Notifications',
    });

    // Allow Textract service to publish to SNS topic
    textractCompletionTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('textract.amazonaws.com')],
        actions: ['SNS:Publish'],
        resources: [textractCompletionTopic.topicArn],
      }),
    );

    // ==========================================
    // 4. OPENSEARCH DOMAIN (DEV OPTIMIZED - ~$20/month)
    // ==========================================
    // Production notes:
    // - Use 3 nodes (t3.medium.search) across 3 AZs
    // - Deploy in private subnets with NAT gateway
    // - Enable dedicated master nodes (3x t3.small.search)
    // - Increase EBS to 100GB+ per node
    // - Enable fine-grained access control
    // - Use VPC endpoints for Lambda access

    const openSearchDomain = new opensearch.Domain(this, 'VectorStoreDomain', {
      domainName: 'docintel-vectors-dev',
      version: opensearch.EngineVersion.OPENSEARCH_2_11,

      // Single node for dev (no cross-AZ replication costs)
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: 't3.small.search',
        masterNodes: 0, // Use data node as master (dev only)
        multiAzWithStandbyEnabled: false, // Explicitly disable multi-AZ standby
      },

      // Single-AZ deployment (dev only)
      zoneAwareness: {
        enabled: false,
      },

      // 30GB EBS for dev (sufficient for testing)
      ebs: {
        volumeSize: 30,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },

      // Public endpoint (no VPC costs for dev)
      // Production: use vpc with private subnets
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },

      // Use resource-based access policy for dev (no fine-grained access control)
      // Production: enable fine-grained access control with proper role mapping

      // Advanced options for dev
      advancedOptions: {
        'indices.query.bool.max_clause_count': '1024',
        'indices.fielddata.cache.size': '40', // 40% of heap
      },

      // Automated snapshots
      automatedSnapshotStartHour: 2, // 2 AM UTC

      // Logging (optional, can disable to save CloudWatch costs)
      logging: {
        slowSearchLogEnabled: true,
        slowIndexLogEnabled: true,
      },

      // Dev only - destroy on stack delete
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================
    // 5. LAMBDA 1: UploadHandler (API Gateway)
    // ==========================================
    const uploadHandler = new lambda.Function(this, 'UploadHandler', {
      functionName: 'DocIntel-UploadHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'upload.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        S3_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        S3_PRESIGNED_URL_EXPIRY: '300',
        DYNAMODB_METADATA_TABLE: metadataTable.tableName,
        DYNAMODB_JOBS_TABLE: jobsTable.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions
    documentsBucket.grantPut(uploadHandler);
    documentsBucket.grantRead(uploadHandler);
    metadataTable.grantWriteData(uploadHandler);

    // ==========================================
    // 5. LAMBDA 2: TextractStartHandler (S3 trigger)
    // ==========================================

    // Create a dedicated role for Textract service to publish SNS notifications
    const textractServiceRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
      description: 'Allows Textract to publish completion notifications to SNS',
    });
    textractCompletionTopic.grantPublish(textractServiceRole);

    const textractStartHandler = new lambda.Function(this, 'TextractStartHandler', {
      functionName: 'DocIntel-TextractStartHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'textract-start.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        S3_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DYNAMODB_METADATA_TABLE: metadataTable.tableName,
        DYNAMODB_JOBS_TABLE: jobsTable.tableName,
        TEXTRACT_SNS_TOPIC_ARN: textractCompletionTopic.topicArn,
        TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions
    documentsBucket.grantRead(textractStartHandler);
    metadataTable.grantWriteData(textractStartHandler);
    jobsTable.grantWriteData(textractStartHandler);

    // Add S3 trigger for ObjectCreated events
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(textractStartHandler),
      {
        prefix: 'documents/',
      },
    );

    // Grant Textract permissions
    textractStartHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:StartDocumentTextDetection',
          'textract:StartDocumentAnalysis',
        ],
        resources: ['*'],
      }),
    );

    // Allow Lambda to pass the Textract service role
    textractStartHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractServiceRole.roleArn],
      }),
    );

    // ==========================================
    // 6. LAMBDA 3: TextractCompleteHandler (SNS trigger)
    // ==========================================
    // Create dedicated IAM role with OpenSearch permissions
    const textractCompleteRole = new iam.Role(this, 'TextractCompleteHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for TextractCompleteHandler with OpenSearch access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    // Grant OpenSearch full access to the role
    textractCompleteRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [openSearchDomain.domainArn, `${openSearchDomain.domainArn}/*`],
      }),
    );

    const textractCompleteHandler = new lambda.Function(this, 'TextractCompleteHandler', {
      functionName: 'DocIntel-TextractCompleteHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'textract-complete.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      role: textractCompleteRole, // Use custom role with OpenSearch permissions
      memorySize: 1024, // More memory for processing large documents
      timeout: cdk.Duration.seconds(300), // 5 minutes for large documents
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        S3_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DYNAMODB_METADATA_TABLE: metadataTable.tableName,
        DYNAMODB_JOBS_TABLE: jobsTable.tableName,
        OPENSEARCH_DOMAIN: `https://${openSearchDomain.domainEndpoint}`,
        OPENSEARCH_INDEX_NAME: 'docintel-vectors',
        TEXTRACT_CONFIDENCE_THRESHOLD: '80',
        TEXTRACT_COST_PER_PAGE: '0.0015',
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions for textract-complete handler
    documentsBucket.grantRead(textractCompleteHandler);
    documentsBucket.grantWrite(textractCompleteHandler); // For storing Textract results
    metadataTable.grantReadWriteData(textractCompleteHandler);
    jobsTable.grantReadWriteData(textractCompleteHandler);

    // Grant Textract read permissions
    textractCompleteHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection', 'textract:GetDocumentAnalysis'],
        resources: ['*'],
      }),
    );

    // Grant OpenSearch access for indexing
    openSearchDomain.grantReadWrite(textractCompleteHandler);

    // Add explicit access policy for the Lambda role
    openSearchDomain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(textractCompleteRole.roleArn)],
        actions: ['es:*'],
        resources: [openSearchDomain.domainArn, `${openSearchDomain.domainArn}/*`],
      }),
    );

    // Grant Bedrock permissions for embeddings
    textractCompleteHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    // Subscribe Lambda to SNS topic
    textractCompletionTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(textractCompleteHandler),
    );

    // ==========================================
    // 8. LAMBDA 4: QueryHandler (API Gateway - RAG)
    // ==========================================
    // Create dedicated IAM role with OpenSearch permissions
    const queryHandlerRole = new iam.Role(this, 'QueryHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for QueryHandler with OpenSearch access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    // Grant OpenSearch full access to the role
    queryHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [openSearchDomain.domainArn, `${openSearchDomain.domainArn}/*`],
      }),
    );

    const queryHandler = new lambda.Function(this, 'QueryHandler', {
      functionName: 'DocIntel-QueryHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'query.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      role: queryHandlerRole, // Use custom role with OpenSearch permissions
      memorySize: 1024, // More memory for embeddings and vector search
      timeout: cdk.Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        OPENSEARCH_DOMAIN: `https://${openSearchDomain.domainEndpoint}`,
        OPENSEARCH_INDEX_NAME: 'docintel-vectors',
        BEDROCK_LLM_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        LOG_LEVEL: 'info',
      },
    });

    // ==========================================
    // 9. LAMBDA 5: DocumentsHandler (API Gateway - List Documents)
    // ==========================================
    const documentsHandler = new lambda.Function(this, 'DocumentsHandler', {
      functionName: 'DocIntel-DocumentsHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'documents.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        DYNAMODB_METADATA_TABLE: metadataTable.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read access to Documents Handler
    metadataTable.grantReadData(documentsHandler);

    // Add Bedrock permissions to the QueryHandler role
    queryHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    // Add AWS Marketplace permissions for Bedrock model activation
    // Note: AWS Marketplace actions don't support resource-level restrictions
    queryHandlerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
        resources: ['*'],
      }),
    );

    // Add explicit access policy for the Lambda role
    openSearchDomain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(queryHandlerRole.roleArn)],
        actions: ['es:*'],
        resources: [openSearchDomain.domainArn, `${openSearchDomain.domainArn}/*`],
      }),
    );

    // Allow public HTTPS access to OpenSearch for dev/debugging (with IAM auth still required)
    // Production: remove this and use VPC security groups
    openSearchDomain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['es:*'],
        resources: [`${openSearchDomain.domainArn}/*`],
        conditions: {
          IpAddress: {
            'aws:SourceIp': [
              // Add your IP address here for dev access
              // Example: '1.2.3.4/32'
              // Or allow all for dev (not recommended for prod)
            ],
          },
        },
      }),
    );

    // Allow Lambda execution roles to access OpenSearch
    openSearchDomain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: queryHandler.role ? [queryHandler.role] : [],
        actions: ['es:*'],
        resources: [`${openSearchDomain.domainArn}/*`],
      }),
    );

    // ==========================================
    // 9. API GATEWAY (REST)
    // ==========================================
    const api = new apigateway.RestApi(this, 'DocIntelApi', {
      restApiName: 'DocIntel API',
      description: 'API for DocIntel document processing - v2',
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'http://localhost:3000',
          'http://localhost:3001',
          'https://localhost:3000',
          'https://*.cloudfront.net',
        ],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: false,
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        description: `Deployment with /documents endpoint - ${Date.now()}`,
      },
    });

    // POST /upload endpoint
    const upload = api.root.addResource('upload');
    upload.addMethod('POST', new apigateway.LambdaIntegration(uploadHandler), {
      apiKeyRequired: false,
    });

    // POST /query endpoint (RAG)
    const query = api.root.addResource('query');
    query.addMethod('POST', new apigateway.LambdaIntegration(queryHandler), {
      apiKeyRequired: false,
    });

    // GET /documents endpoint (list documents with status)
    const documents = api.root.addResource('documents');
    documents.addMethod('GET', new apigateway.LambdaIntegration(documentsHandler), {
      apiKeyRequired: false,
    });

    // ==========================================
    // 10. OUTPUTS
    // ==========================================
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'DocIntelApiEndpoint',
    });

    new cdk.CfnOutput(this, 'UploadEndpoint', {
      value: `${api.url}upload`,
      description: 'Upload endpoint URL (POST)',
      exportName: 'DocIntelUploadEndpoint',
    });

    new cdk.CfnOutput(this, 'QueryEndpoint', {
      value: `${api.url}query`,
      description: 'Query endpoint URL (POST) - RAG question-answering',
      exportName: 'DocIntelQueryEndpoint',
    });

    new cdk.CfnOutput(this, 'DocumentsEndpoint', {
      value: `${api.url}documents`,
      description: 'Documents endpoint URL (GET) - List documents with status',
      exportName: 'DocIntelDocumentsEndpoint',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for document uploads',
      exportName: 'DocIntelDocumentsBucket',
    });

    new cdk.CfnOutput(this, 'MetadataTableName', {
      value: metadataTable.tableName,
      description: 'DynamoDB metadata table',
      exportName: 'DocIntelMetadataTable',
    });

    new cdk.CfnOutput(this, 'JobsTableName', {
      value: jobsTable.tableName,
      description: 'DynamoDB jobs table',
      exportName: 'DocIntelJobsTable',
    });

    new cdk.CfnOutput(this, 'TextractCompletionTopicArn', {
      value: textractCompletionTopic.topicArn,
      description: 'SNS topic for Textract completion notifications',
      exportName: 'DocIntelTextractCompletionTopic',
    });

    new cdk.CfnOutput(this, 'OpenSearchDomainEndpoint', {
      value: openSearchDomain.domainEndpoint,
      description: 'OpenSearch domain endpoint (vector store)',
      exportName: 'DocIntelOpenSearchEndpoint',
    });

    new cdk.CfnOutput(this, 'OpenSearchDashboardUrl', {
      value: `https://${openSearchDomain.domainEndpoint}/_dashboards`,
      description: 'OpenSearch Dashboards URL',
      exportName: 'DocIntelOpenSearchDashboard',
    });

    // ==========================================
    // CUSTOM RESOURCE: Initialize OpenSearch Index
    // ==========================================
    const indexInitHandler = new NodejsFunction(this, 'OpenSearchIndexInitHandler', {
      functionName: 'DocIntel-OpenSearchIndexInit',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lib/opensearch-index-init.js'),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        INDEX_NAME: 'docintel-vectors',
        OPENSEARCH_ENDPOINT: `https://${openSearchDomain.domainEndpoint}`,
      },
      bundling: {
        minify: false,
        sourceMap: true,
        externalModules: [],
      },
    });

    // Grant permissions to manage OpenSearch index
    openSearchDomain.grantReadWrite(indexInitHandler);
    indexInitHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPut',
          'es:ESHttpPost',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [openSearchDomain.domainArn, `${openSearchDomain.domainArn}/*`],
      }),
    );

    // Create custom resource provider
    const indexInitProvider = new cr.Provider(this, 'OpenSearchIndexInitProvider', {
      onEventHandler: indexInitHandler,
    });

    // Create custom resource (will run during deployment)
    const indexInitResource = new cdk.CustomResource(this, 'OpenSearchIndexInit', {
      serviceToken: indexInitProvider.serviceToken,
      properties: {
        IndexName: 'docintel-vectors',
        Timestamp: Date.now(), // Force update on every deployment
      },
    });

    // Ensure index is created after OpenSearch domain
    indexInitResource.node.addDependency(openSearchDomain);

    // Store API URL for use in other stacks
    this.apiUrl = api.url;
  }
}
