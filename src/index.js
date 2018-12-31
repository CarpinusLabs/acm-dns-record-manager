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

  if (message.ResourceType !== 'AWS::CertificateManager::Certificate') {
    return;
  }

  if (message.ResourceStatus === 'CREATE_IN_PROGRESS' && message.PhysicalResourceId !== undefined) {
    await processCreateInProgressMessage(message);
  } else if (message.ResourceStatus === 'DELETE_COMPLETE') {
    await processDeleteCompleteMessage(message);
  }
};

async function processCreateInProgressMessage(message) {
  const certificateArn = message.PhysicalResourceId;

  console.log(`Getting Hosted Zone ID for certificate ${certificateArn}...`);
  const hostedZoneId = await getHostedZoneIdForCertificate(certificateArn);
  if (hostedZoneId === null) {
    console.log(`Failed to get Hosted Zone ID for certificate ${certificateArn}. Make sure to assign it by adding the tag "HostedZoneID".`);
    return;
  }

  console.log(`Getting resource records for certificate ${certificateArn}...`);
  const resourceRecords = await getResourceRecordsForCertificate(certificateArn);

  console.log(`Creating resource records for certificate ${certificateArn}...`);
  await createCNAMERecord(resourceRecords, hostedZoneId);
}

async function processDeleteCompleteMessage(message) {
  console.log(`Certificate ${message.PhysicalResourceId} has been deleted`);
  const properties = JSON.parse(message.ResourceProperties);

  const hostedZoneId = getHostedZoneIdFromTags(properties.Tags);
  if (hostedZoneId === null) {
    return;
  }

  let domainNames = [ properties.DomainName ];
  if (properties.SubjectAlternativeNames) {
    domainNames = domainNames.concat(properties.SubjectAlternativeNames);
  }

  const acmRecords = await getACMRecords(hostedZoneId);
  if (acmRecords.length === 0) {
    return;
  }

  const resourceRecords = getResourceRecordsForDomains(acmRecords, domainNames);

  await deleteCNAMERecord(resourceRecords, hostedZoneId);
}

async function getHostedZoneIdForCertificate(arn) {
  const params = {
    CertificateArn: arn
  };

  try {
    const result = await acm.listTagsForCertificate(params).promise();
    return getHostedZoneIdFromTags(result.Tags);
  } catch (error) {
    console.log('Failed to get tags for certificate ' + arn);
    throw error;
  }
}

function getHostedZoneIdFromTags(tags) {
  const filteredTags = tags.filter((tag) => {
    return (tag.Key === 'HostedZoneId');
  });

  return filteredTags.length === 0 ? null : filteredTags[0].Value;
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

async function deleteCNAMERecord(records, hostedZoneId) {
  const changes = records.map((record) => {
    return {
      Action: 'DELETE',
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
    console.log('Failed to delete Route 53 record set: ' + error);
    throw error;
  }
}

async function getACMRecords(hostedZoneId) {
  const params = {
    HostedZoneId: hostedZoneId
  };

  try {
    const result = await route53.listResourceRecordSets(params).promise();
    return result.ResourceRecordSets.filter((record) => {
      if (record.Type !== 'CNAME') {
        return false;
      }

      let acmRecords = record.ResourceRecords.filter((item) => {
        return item.Value.endsWith('.acm-validations.aws.');
      });
      return acmRecords.length > 0;
    });
  } catch (error) {
    console.log('Failed to list resource records of hosted zone "' + hostedZoneId + '": ' + error);
    throw error;
  }
}

function getDomainNameForACMRecord(record) {
  const regexp = /_[^\.]+\.(.+)\./;
  const result = regexp.exec(record.Name);
  return result[1];
}

function getResourceRecordsForDomains(records, domains) {
  return records.filter((record) => {
    return domains.includes(getDomainNameForACMRecord(record));
  }).map((record) => {
    return {
      Name: record.Name,
      Type: record.Type,
      Value: record.ResourceRecords[0].Value
    };
  });
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
