# Textract Start Handler - IAM Policy for CDK

Add this to your CDK `api-stack.ts` Lambda function configuration:

## Required IAM Permissions

```typescript
// S3 Permissions for reading uploaded files
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['s3:GetObject', 's3:GetObjectMetadata', 's3:HeadObject'],
    resources: [`${props.documentsBucket.bucketArn}/*`],
  }),
);

// DynamoDB Permissions for metadata and job tracking
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
    resources: [
      `arn:aws:dynamodb:${this.region}:${this.account}:table/DocIntel-DocumentMetadata`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/DocIntel-ProcessingJobs`,
    ],
  }),
);

// Textract Permissions for starting jobs
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['textract:StartDocumentTextDetection', 'textract:GetDocumentTextDetection'],
    resources: ['*'], // Textract doesn't support resource-level permissions
  }),
);

// SNS Permissions for Textract completion notifications
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['sns:Publish'],
    resources: [textractSNSTopic.topicArn],
  }),
);

// CloudWatch Logs (usually auto-granted by CDK)
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
    resources: ['arn:aws:logs:*:*:*'],
  }),
);

// X-Ray Tracing (optional)
apiFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
    resources: ['*'],
  }),
);
```

## Textract Service Role

Textract needs a role to publish to SNS when jobs complete:

```typescript
// Create Textract service role
const textractRole = new iam.Role(this, 'TextractServiceRole', {
  assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
  description: 'Allows Textract to publish completion notifications to SNS',
});

// Grant SNS publish permissions
textractRole.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['sns:Publish'],
    resources: [textractSNSTopic.topicArn],
  }),
);

// Pass role ARN to Lambda via environment variable
const apiFunction = new lambda.Function(this, 'TextractStartFunction', {
  // ... other config
  environment: {
    TEXTRACT_ROLE_ARN: textractRole.roleArn,
    TEXTRACT_SNS_TOPIC_ARN: textractSNSTopic.topicArn,
    DYNAMODB_METADATA_TABLE: 'DocIntel-DocumentMetadata',
    DYNAMODB_JOBS_TABLE: 'DocIntel-ProcessingJobs',
  },
});
```

## S3 Event Notification

Configure S3 to trigger Lambda on PDF uploads:

```typescript
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

// Add event notification to S3 bucket
props.documentsBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(textractStartFunction),
  {
    suffix: '.pdf', // Only trigger for PDF files
  },
);
```

## Complete Stack Example

```typescript
export class TextractStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TextractStackProps) {
    super(scope, id, props);

    // 1. Create SNS topic for Textract completion notifications
    const textractTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      displayName: 'Textract Job Completion Notifications',
    });

    // 2. Create Textract service role
    const textractRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
    });

    textractRole.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: [textractTopic.topicArn],
      }),
    );

    // 3. Create Lambda function for starting Textract jobs
    const textractStartFunction = new lambda.Function(this, 'TextractStartFunction', {
      functionName: 'docintel-textract-start',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'textract-start.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        AWS_REGION: this.region,
        TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
        TEXTRACT_ROLE_ARN: textractRole.roleArn,
        DYNAMODB_METADATA_TABLE: props.metadataTable.tableName,
        DYNAMODB_JOBS_TABLE: props.jobsTable.tableName,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: 7,
    });

    // 4. Grant permissions
    props.documentsBucket.grantRead(textractStartFunction);
    props.metadataTable.grantReadWriteData(textractStartFunction);
    props.jobsTable.grantReadWriteData(textractStartFunction);

    textractStartFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      }),
    );

    // 5. Configure S3 event notification
    props.documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(textractStartFunction),
      { suffix: '.pdf' },
    );

    // 6. Create Lambda for handling Textract completion
    const textractCompleteFunction = new lambda.Function(
      this,
      'TextractCompleteFunction',
      {
        functionName: 'docintel-textract-complete',
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'textract-complete.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build')),
        memorySize: 1024,
        timeout: cdk.Duration.minutes(5),
        environment: {
          NODE_ENV: 'production',
          AWS_REGION: this.region,
          DYNAMODB_METADATA_TABLE: props.metadataTable.tableName,
          DYNAMODB_JOBS_TABLE: props.jobsTable.tableName,
          DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
        },
        tracing: lambda.Tracing.ACTIVE,
        logRetention: 7,
      },
    );

    // Grant permissions for completion handler
    props.metadataTable.grantReadWriteData(textractCompleteFunction);
    props.jobsTable.grantReadWriteData(textractCompleteFunction);
    props.documentsBucket.grantReadWrite(textractCompleteFunction);

    textractCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['textract:GetDocumentTextDetection', 'textract:GetDocumentAnalysis'],
        resources: ['*'],
      }),
    );

    // 7. Subscribe completion handler to SNS topic
    textractTopic.addSubscription(new subs.LambdaSubscription(textractCompleteFunction));

    // Outputs
    new cdk.CfnOutput(this, 'TextractTopicArn', {
      value: textractTopic.topicArn,
      description: 'SNS Topic for Textract completion notifications',
    });

    new cdk.CfnOutput(this, 'TextractRoleArn', {
      value: textractRole.roleArn,
      description: 'IAM Role for Textract service',
    });
  }
}
```

## DynamoDB Table Schemas

### DocIntel-DocumentMetadata

```typescript
{
  documentId: string;          // UUID v4
  filename: string;            // Original filename
  bucket: string;              // S3 bucket name
  s3Key: string;               // S3 object key
  uploadDate: string;          // ISO 8601 timestamp
  status: string;              // TEXTRACT_PENDING | TEXTRACT_IN_PROGRESS | TEXTRACT_COMPLETED | TEXTRACT_FAILED
  fileSize: number;            // File size in bytes
  contentType: string;         // MIME type
  textractJobId?: string;      // Textract job ID
  errorMessage?: string;       // Error details if failed
  createdAt: string;           // ISO 8601 timestamp
  updatedAt?: string;          // ISO 8601 timestamp
}
```

### DocIntel-ProcessingJobs

```typescript
{
  jobId: string;               // Textract job ID (PK)
  documentId: string;          // Reference to document
  bucket: string;              // S3 bucket name
  s3Key: string;               // S3 object key
  status: string;              // TEXTRACT_IN_PROGRESS | COMPLETED | FAILED
  textractJobId: string;       // Same as jobId
  createdAt: string;           // ISO 8601 timestamp
  completedAt?: string;        // ISO 8601 timestamp
  errorMessage?: string;       // Error details if failed
}
```

## Environment Variables

Required environment variables for the handler:

- `AWS_REGION`: AWS region (e.g., us-east-1)
- `DYNAMODB_METADATA_TABLE`: Document metadata table name
- `DYNAMODB_JOBS_TABLE`: Processing jobs table name
- `TEXTRACT_SNS_TOPIC_ARN`: SNS topic ARN for completion notifications
- `TEXTRACT_ROLE_ARN`: IAM role ARN for Textract service
- `LOG_LEVEL`: Logging level (default: info)

## Testing

Run tests:

```bash
cd apps/api
pnpm test textract-start.handler.test.ts
```

Check coverage:

```bash
pnpm test:coverage textract-start.handler.test.ts
```
