import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class MinimalStack extends cdk.Stack {
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
    // 4. LAMBDA 1: UploadHandler (API Gateway)
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
    const textractCompleteHandler = new lambda.Function(this, 'TextractCompleteHandler', {
      functionName: 'DocIntel-TextractCompleteHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'textract-complete.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build/handlers')),
      memorySize: 1024, // More memory for processing large documents
      timeout: cdk.Duration.seconds(300), // 5 minutes for large documents
      environment: {
        NODE_ENV: 'production',
        AWS_ACCOUNT_ID: this.account,
        DYNAMODB_METADATA_TABLE: metadataTable.tableName,
        DYNAMODB_JOBS_TABLE: jobsTable.tableName,
        TEXTRACT_CONFIDENCE_THRESHOLD: '80',
        TEXTRACT_COST_PER_PAGE: '0.0015',
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions for textract-complete handler
    metadataTable.grantReadWriteData(textractCompleteHandler);
    jobsTable.grantReadWriteData(textractCompleteHandler);

    // Grant Textract read permissions
    textractCompleteHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection', 'textract:GetDocumentAnalysis'],
        resources: ['*'],
      }),
    );

    // Subscribe Lambda to SNS topic
    textractCompletionTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(textractCompleteHandler),
    );

    // ==========================================
    // 7. API GATEWAY (REST)
    // ==========================================
    const api = new apigateway.RestApi(this, 'DocIntelApi', {
      restApiName: 'DocIntel API',
      description: 'API for DocIntel document processing',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // POST /upload endpoint
    const upload = api.root.addResource('upload');
    upload.addMethod('POST', new apigateway.LambdaIntegration(uploadHandler), {
      apiKeyRequired: false,
    });

    // ==========================================
    // 8. OUTPUTS
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
  }
}
