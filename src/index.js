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
  let message = parseMessage(event.Sns.Message);

  if (message.ResourceStatus === 'CREATE_IN_PROGRESS' && message.ResourceType === 'AWS::CertificateManager::Certificate' && message.PhysicalResourceId !== undefined) {
    const certificate_arn = message.PhysicalResourceId;

    console.log(`Getting Hosted Zone ID for certificate ${certificate_arn}...`);
    const hostedZoneId = await getHostedZoneIdForCertificate(certificate_arn);
    if (hostedZoneId === null) {
      console.log(`Failed to get Hosted Zone ID for certificate ${certificate_arn}. Make sure to assign it by adding the tag "HostedZoneID".`);
      return;
    }

    console.log(`Getting resource records for certificate ${certificate_arn}...`);
    const resource_records = await getResourceRecordsForCertificate(certificate_arn);

    console.log(`Creating resource records for certificate ${certificate_arn}...`);
    await createCNAMERecord(resource_records, hostedZoneId);
  }
};

async function getHostedZoneIdForCertificate(arn) {
  const params = {
    CertificateArn: arn
  };

  try {
    const result = await acm.listTagsForCertificate(params).promise();

    const tags = result.Tags.filter((tag) => {
      return (tag.Key === 'HostedZoneId');
    });

    return tags.length === 0 ? null : tags[0].Value;
  } catch (error) {
    console.log('Failed to get tags for certificate ' + arn);
    throw error;
  }
}

async function getResourceRecordsForCertificate(arn) {
  // Check every 10 seconds if the resource records have been assigned to the certificate
  let resourceRecords = null;
  while ((resourceRecords = await doGetResourceRecordsForCertificate(arn)) === null) {
    await sleep(10000);
  }
  return resourceRecords;
}

async function doGetResourceRecordsForCertificate(arn) {
  const params = {
    CertificateArn: arn
  };

  try {
    let result = await acm.describeCertificate(params).promise();

    let resourceRecords = result.Certificate.DomainValidationOptions.filter((domain) => {
      return (domain.ResourceRecord !== undefined);
    }).map((item) => {
      return item.ResourceRecord;
    });

    return resourceRecords.length === 0 ? null : resourceRecords;
  } catch (error) {
    console.log('Failed to fetch information for certificate ' + arn + ': ' + error);
    throw error;
  }
}

async function createCNAMERecord(records, hostedZoneId) {
  const changes = records.map((record) => {
    return {
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
    };
  });

  const params = {
    ChangeBatch: {
      Changes: changes
    },
    HostedZoneId: hostedZoneId
  };

  try {
    await route53.changeResourceRecordSets(params).promise();
  } catch (error) {
    console.log('Failed to create Route 53 record set: ' + error);
    throw error;
  }
}

function parseMessage(message) {
  const regexp = /(.+)='([^']*)'/g;

  let msg = {};
  let result;
  while((result = regexp.exec(message)) !== null) {
    msg[result[1]] = result[2].trim();
  }

  return msg;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
