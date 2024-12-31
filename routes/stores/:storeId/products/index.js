'use strict';

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

      // Fetch all products for the store
      const products = await knex('products')
          .where({ storeId })
          .orderBy('created_at', 'desc');

      if (!products || products.length === 0) {
        return reply.status(404).send({ error: 'No products found for this store.' });
      }

      // Fetch product-collection relations and collection details
      const productIds = products.map((product) => product.productId);
      const productCollections = await knex('productCollections')
          .join('collections', 'productCollections.collectionId', 'collections.collectionId')
          .whereIn('productCollections.productId', productIds)
          .select(
              'productCollections.productId',
              'collections.collectionId',
              'collections.collectionName'
          );

      // Group collections by productId
      const collectionsByProduct = productCollections.reduce((acc, pc) => {
        if (!acc[pc.productId]) {
          acc[pc.productId] = [];
        }
        acc[pc.productId].push({
          collectionId: pc.collectionId,
          collectionName: pc.collectionName,
        });
        return acc;
      }, {});

      // Map collections to products
      const productsWithCollections = products.map((product) => ({
        ...product,
        collections: collectionsByProduct[product.productId] || [],
      }));

      return reply.send(productsWithCollections);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch products for the store.' });
    }
  });
};