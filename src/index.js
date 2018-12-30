'use strict';

const aws = require('aws-sdk');

const route53 = new aws.Route53();
const acm = new aws.ACM();

exports.handler = async (event) => {
  await Promise.all(event.Records.map((record) => {
    return this.processEvent(record);
  }));
};

exports.processEvent = async (event) => {
  let message = event.Sns.Message;

  if (message.indexOf("ResourceStatus='CREATE_IN_PROGRESS'") != -1 && message.indexOf("ResourceType='AWS::CertificateManager::Certificate'") != -1 && message.indexOf("PhysicalResourceId=") != -1) {
    const regexp = /PhysicalResourceId='(.+)'\n/;
    const result = regexp.exec(message);
    const certificate_arn = result[1];

    const hostedZoneId = await getHostedZoneIdForCertificate(certificate_arn);
    if (hostedZoneId === null) {
      return;
    }

    // Wait for the resource records to "appear". This smells bad!!!
    await sleep(45000);

    const resource_records = await getResourceRecordsForCertificate(certificate_arn);

    await Promise.all(resource_records.map((record) => {
      return this.createCNAMERecord(record, hostedZoneId);
    }));
  }
};

exports.createCNAMERecord = async (record, hostedZoneId) => {
  const params = {
    ChangeBatch: {
      Changes: [
        {
          Action: 'CREATE',
          ResourceRecordSet: {
            Name: record.Name,
            ResourceRecords: [
              {
                Value: record.Value
              }
            ],
            TTL: 300,
            Type: record.Type
          }
        }
      ]
    },
    HostedZoneId: hostedZoneId
  };

  try {
    const result = await route53.changeResourceRecordSets(params).promise();
  } catch (error) {
    console.log('Failed to create Route 53 record set: ' + error);
    throw error;
  }
};

async function getHostedZoneIdForCertificate(arn) {
  const params = {
    CertificateArn: arn
  };

  try {
    const result = await acm.listTagsForCertificate(params).promise();

    const tags = result.Tags.filter((tag) => {
      return (tag.Key === 'HostedZoneId');
    });

    if (tags.length === 0) {
      return null;
    }
    return tags[0].Value;
  } catch (error) {
    console.log('Failed to get HostedZoneId for certificate ' + arn);
    throw error;
  }
}

async function getResourceRecordsForCertificate(arn) {
  const params = {
    CertificateArn: arn
  };

  try {
    const result = await acm.describeCertificate(params).promise();

    return result.Certificate.DomainValidationOptions.map((item) => {
      return item.ResourceRecord;
    });
  } catch (error) {
    console.log('Failed to fetch information for certificate ' + arn + ': ' + error);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}