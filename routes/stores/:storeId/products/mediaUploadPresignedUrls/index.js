'use strict';

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const {mediaItems} = request.body;
    if (!storeId || !mediaItems || !Array.isArray(mediaItems)) {
      return reply.status(400).send({ error: 'Invalid request. storeId and mediaItems are required.' });
    }

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Generate presigned URLs for all fileKeys
      const presignedUrls = await Promise.all(
          mediaItems.map(async (item) => {
            const params = {
              Bucket: 'pocketshop-media', // Replace with your Space name
              Key: item.fileKey,
              ContentType: item.contentType, // Adjust content type as needed
              ACL: 'public-read', // Adjust based on your access needs
            };

            const presignedUrl = await s3.getSignedUrlPromise('putObject', params);

            return {
              presignedUrl,
              fileUri: `https://pocketshop-media.blr1.cdn.digitaloceanspaces.com/${item.fileKey}`,
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