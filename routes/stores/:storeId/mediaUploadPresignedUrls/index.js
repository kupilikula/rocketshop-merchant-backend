'use strict';
require('dotenv').config();

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Configure AWS SDK v3 S3 Client
const s3Client = new S3Client({
  endpoint: 'https://blr1.digitaloceanspaces.com',
  region: 'us-east-1', // DigitalOcean Spaces uses this region format
  credentials: {
    accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SPACES_SECRET_KEY,
  },
});

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const { fileKeysWithContentTypes } = request.body;

      if (!storeId || !fileKeysWithContentTypes || !Array.isArray(fileKeysWithContentTypes) || fileKeysWithContentTypes.length === 0) {
          return reply.status(400).send({ error: 'storeId and fileKeysWithContentTypes array is required.' });
      }

    try {

      // Generate presigned URLs for all fileKeys
      const presignedUrls = await Promise.all(
          fileKeysWithContentTypes.map(async (item) => {
            const params = {
              Bucket: process.env.SPACES_MEDIA_BUCKET, // Replace with your Space name
              Key: item.fileKey,
              ContentType: item.contentType, // Adjust content type as needed
              ACL: 'public-read', // Adjust based on your access needs
            };

            const command = new PutObjectCommand(params);
            const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL valid for 1 hour

            return {
              presignedUrl,
              fileUri: `https://${process.env.SPACES_MEDIA_BUCKET}.blr1.cdn.digitaloceanspaces.com/${item.fileKey}`,
            };
          })
      );

      return reply.send(presignedUrls);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to generate presigned urls.' });
    }
  });
};