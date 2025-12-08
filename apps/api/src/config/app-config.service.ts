import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private configService: NestConfigService) {}

  get aws() {
    return {
      region: this.configService.get<string>('app.aws.region'),
      accountId: this.configService.get<string>('app.aws.accountId'),
    };
  }

  get s3() {
    return {
      documentsBucket: this.configService.get<string>('app.s3.documentsBucket'),
      presignedUrlExpiry: this.configService.get<number>('app.s3.presignedUrlExpiry'),
    };
  }

  get dynamodb() {
    return {
      metadataTable: this.configService.get<string>('app.dynamodb.metadataTable'),
      jobsTable: this.configService.get<string>('app.dynamodb.jobsTable'),
    };
  }

  get textract() {
    return {
      snsTopicArn: this.configService.get<string>('app.textract.snsTopicArn'),
      roleArn: this.configService.get<string>('app.textract.roleArn'),
    };
  }

  get logging() {
    return {
      level: this.configService.get<string>('app.logging.level'),
    };
  }
}
