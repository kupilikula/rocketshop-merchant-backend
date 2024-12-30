'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch store details
      const store = await knex('stores')
          .where({ storeId })
          .first(); // Fetch all fields

      if (!store) {
        return reply.status(404).send({ error: 'Store not found.' });
      }

      // Fetch collections for the store
      const collections = await knex('collections')
          .where({ storeId, isActive: true }) // Only active collections
          .orderBy('displayOrder', 'asc'); // Fetch all fields

      for (const collection of collections) {
        // Fetch products for each collection
        const products = await knex('products')
            .where({ storeId, isActive: true })
            .andWhereRaw('? = ANY(collectionIds)', [collection.collectionId]) // Match collectionId in collectionIds array
            .orderBy('displayOrder', 'asc') // Fetch all fields
            .limit(collection.storeFrontDisplayNumberOfItems);

        // Parse JSON fields if necessary
        products.forEach(product => {
          product.mediaItems = JSON.parse(product.mediaItems || '[]');
        });

        collection.products = products;
      }

      return reply.send({ ...store, collections });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch store front data.' });
    }
  });

}
