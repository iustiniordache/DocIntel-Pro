import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  documentsBucket: s3.Bucket;
}

export class DocIntelProApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // CloudWatch Logs role for API Gateway
    const apiGatewayLogsRole = new iam.Role(this, 'ApiGatewayLogsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ),
      ],
    });

    // Set the CloudWatch Logs role for API Gateway account settings
    const cfnAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayLogsRole.roleArn,
    });

    // Lambda function
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      functionName: 'docintel-pro-api',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/build')),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: 'production',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: 7,
    });

    // Grant permissions
    props.documentsBucket.grantReadWrite(apiFunction);

    // Grant Textract permissions
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'textract:DetectDocumentText',
          'textract:AnalyzeDocument',
          'textract:StartDocumentAnalysis',
          'textract:GetDocumentAnalysis',
        ],
        resources: ['*'],
      }),
    );

    // Grant Bedrock permissions
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'DocIntel Pro API',
      description: 'DocIntel Pro Document Processing API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
    });

    // Ensure API Gateway account is configured before creating the API
    api.node.addDependency(cfnAccount);

    // Lambda integration
    const integration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
    });

    // Routes
    api.root.addProxy({
      defaultIntegration: integration,
      anyMethod: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: 'DocIntelProApiUrl',
    });

    new cdk.CfnOutput(this, 'ApiFunctionName', {
      value: apiFunction.functionName,
      description: 'Lambda function name',
      exportName: 'DocIntelProApiFunction',
    });
  }
}
