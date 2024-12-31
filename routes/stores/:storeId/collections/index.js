'use strict'

const knex = require("@database/knexInstance");
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

      // Fetch all collections for the store
      const collections = await knex('collections')
          .where({ storeId })
          .orderBy('displayOrder', 'asc'); // Fetch all fields and order by displayOrder

      if (!collections.length) {
        return reply.status(404).send({ error: 'No collections found for this store.' });
      }

      // Fetch product counts for each collection
      const productCounts = await knex('productCollections')
          .join('products', 'productCollections.productId', 'products.productId')
          .select(
              'productCollections.collectionId',
              knex.raw('SUM(CASE WHEN products.isActive THEN 1 ELSE 0 END) as activeProducts'),
              knex.raw('SUM(CASE WHEN NOT products.isActive THEN 1 ELSE 0 END) as inactiveProducts')
          )
          .whereIn('productCollections.collectionId', collections.map((c) => c.collectionId))
          .groupBy('productCollections.collectionId');

      // Map product counts into the collections
      const collectionsWithCounts = collections.map((collection) => {
        const productCount = productCounts.find(
            (count) => count.collectionId === collection.collectionId
        ) || { activeProducts: 0, inactiveProducts: 0 };

        return {
          ...collection,
          activeProducts: parseInt(productCount.activeProducts, 10),
          inactiveProducts: parseInt(productCount.inactiveProducts, 10),
        };
      });

      return reply.send(collectionsWithCounts);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch collections.' });
    }
  });
}