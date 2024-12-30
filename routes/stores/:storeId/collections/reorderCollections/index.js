'use strict'

const knex = require("knex");

module.exports = async function (fastify, opts) {
  fastify.patch('/', async (request, reply) => {
    const { storeId } = request.params;
    const { collectionOrders } = request.body; // Example: [{ collectionId: 1, displayOrder: 2 }, ...]

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Update displayOrder for collections
      const updatePromises = collectionOrders.map(({ collectionId, displayOrder }) =>
          knex('collections')
              .where({ collectionId, storeId })
              .update({ displayOrder })
      );

      await Promise.all(updatePromises);

      return reply.send({ message: 'Collection order updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update collection order.' });
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
