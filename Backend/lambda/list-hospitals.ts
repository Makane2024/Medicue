import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

const s3Client = new S3Client({});
const DOC_URL_TTL_SECONDS = 900;

// Platform admin only: lists hospitals by status, with a short-lived link to the verification PDF.
export const handler = withErrorHandling(async (event) => {
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const status = event.queryStringParameters?.status;
  if (!status || !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new HttpError(400, 'status query parameter must be PENDING, APPROVED or REJECTED');
  }

  const hospitals = await queryAll({
    TableName: process.env.HOSPITALS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :status',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': status },
  });

  const withLinks = await Promise.all(
    hospitals.map(async (hospital) => ({
      ...hospital,
      verificationDocUrl: hospital.verificationDocKey
        ? await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: hospital.verificationDocKey }),
            { expiresIn: DOC_URL_TTL_SECONDS }
          )
        : undefined,
    }))
  );

  return respond(200, { hospitals: withLinks });
});
