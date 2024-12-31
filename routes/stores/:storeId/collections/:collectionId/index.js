'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch collection details
      const collection = await knex('collections')
          .where({ collectionId, storeId })
          .first();

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found.' });
      }

      // Fetch products in the collection
      const products = await knex('products')
          .where({ storeId })
          .andWhereRaw('? = ANY("collectionIds")', [collectionId]) // Match collectionId in collectionIds array
          .orderBy('displayOrder', 'asc'); // Fetch all products ordered by displayOrder

      products.forEach(product => {
        product.mediaItems = JSON.parse(product.mediaItems || '[]');
      });

      return reply.send({ ...collection, products });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch collection details.' });
    }
  });
  fastify.patch('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;
    const updates = request.body; // JSON body containing the updates (e.g., isActive, storeFrontDisplay)

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Update collection settings
      const result = await knex('collections')
          .where({ collectionId, storeId })
          .update(updates);

      if (!result) {
        return reply.status(404).send({ error: 'Collection not found or not updated.' });
      }

      return reply.send({ message: 'Collection updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update collection settings.' });
    }
  });
// Utility function to validate merchant's access to the store
}
