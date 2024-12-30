'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store (optional, based on your auth system)
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch all products for the store, selecting all fields
      const products = await knex('products')
          .where({ storeId })
          .orderBy('created_at', 'desc');

      // Format mediaItems if stored as JSON
      products.forEach(product => {
        product.mediaItems = JSON.parse(product.mediaItems || '[]');
      });

      if (!products || products.length === 0) {
        return reply.status(404).send({ error: 'No products found for this store.' });
      }

      return reply.send(products);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch products for the store.' });
    }
  });

}
