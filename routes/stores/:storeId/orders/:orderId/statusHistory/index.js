'use strict'

const knex = require("knex");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, orderId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch the status history
      const history = await knex('order_status_history')
          .where({ orderId })
          .orderBy('updatedAt', 'asc');

      return reply.send(history);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch order status history.' });
    }
  });

// Utility function to validate merchant's access to the store
  async function validateMerchantAccessToStore(merchantId, storeId) {
    const store = await knex('stores')
        .where({ storeId, merchantId })
        .first();
    return !!store;
  }
}
