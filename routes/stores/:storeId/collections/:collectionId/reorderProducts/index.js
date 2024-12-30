'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {

  fastify.patch('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;
    const { productOrders } = request.body; // Example: [{ productId: 101, displayOrder: 1 }, ...]

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Update displayOrder for products in the collection
      const updatePromises = productOrders.map(({ productId, displayOrder }) =>
          knex('products')
              .where({ productId, storeId })
              .update({ displayOrder })
      );

      await Promise.all(updatePromises);

      return reply.send({ message: 'Product order updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update product order.' });
    }
  });

}
