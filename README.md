# ACM DNS Record Manager

This application processes events from CloudFormation to create CNAME records in Route 53 for certificates issued by _Amazon Certificate Manager_ (ACM) with DNS validation method.

>**Update:** CloudFormation supports [automatic certificate validation via DNS](https://aws.amazon.com/de/about-aws/whats-new/2020/06/aws-certificate-manager-extends-automation-certificate-issuance-via-cloudformation/) now. Therefore, this application is no longer needed.

## Installation

### Serverless Application Repository

The application is available in the [AWS Serverless Application Repository](https://aws.amazon.com/serverless/serverlessrepo/) and can be [deployed directly from there](https://serverlessrepo.aws.amazon.com/#/applications/arn:aws:serverlessrepo:us-east-1:022876999554:applications~acm-dns-record-manager). This is the easiest and most convenient way.

### Manually

The application can be installed by running the following commands:

```
aws cloudformation package --template-file sam-template.yaml --s3-bucket $S3_BUCKET --output-template-file sam-template-output.yaml
aws cloudformation deploy --template-file sam-template-output.yaml --stack-name acm-dns-record-manager --capabilities CAPABILITY_IAM
```

Afterwards, you can get the ARN of the SNS topic from the outputs of the stack either from the console or by using this command:

```
aws cloudformation describe-stacks --stack-name acm-dns-record-manager --query "Stacks[0].Outputs[?OutputKey=='CloudFormationEventsTopicArn'].OutputValue" --output text
```

You refer to this SNS topic ARN when a new CloudFormation stack with a ACM Certificate resource is created for which the DNS validation records shoudl be added automatically.

## How to use it

Tag your ACM certificates with the HostedZoneId to which the CNAME records for certificate validation should be added:

```
AWSTemplateFormatVersion: '2010-09-09'

Parameters:

  DomainName:
    Type: String
    Description: The domain name for which the certificate should be issued
  HostedZone:
    Type: AWS::Route53::HostedZone::Id
    Description: The Route 53 Hosted Zone to which the CNAME records for DNS validation of ACM certificates should be added

Resources:

  Certificate:
    Type: AWS::CertificateManager::Certificate
    Properties:
      DomainName:
        Ref: DomainName
      ValidationMethod: DNS
      Tags:
        - Key: HostedZoneId
          Value:
            Ref: HostedZone
```
