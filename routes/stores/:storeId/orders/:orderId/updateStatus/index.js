'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.patch('/', async (request, reply) => {
    const { storeId, orderId } = request.params;
    const { newStatus } = request.body; // New status to update

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Ensure the order exists
      const order = await knex('orders')
          .where({ orderId, storeId })
          .first();

      if (!order) {
        return reply.status(404).send({ error: 'Order not found.' });
      }

      // Update the current status and timestamp in the orders table
      await knex('orders')
          .where({ orderId })
          .update({
            orderStatus: newStatus,
            orderStatusUpdateTime: new Date(),
          });

      // Insert the status update into the order_status_history table
      await knex('order_status_history').insert({
        orderId,
        status: newStatus,
        updatedAt: new Date(),
      });

      return reply.send({ message: 'Order status updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update order status.' });
    }
  });

}
