'use strict'

const {v4: uuidv4} = require('uuid');
const knex = require("@database/knexInstance");
const {checkPreferencesAndSendNotificationToCustomer, CustomerNotificationTypes} = require("../../../../../../services/PushNotificationsToCustomerService");

module.exports = async function (fastify, opts) {
  fastify.patch('/', async (request, reply) => {
    const { storeId, orderId } = request.params;
    const { newStatus } = request.body; // New status to update

    try {
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

      const customerId = order.customerId;

      // Insert the status update into the order_status_history table
      await knex('order_status_history').insert({
        orderStatusId: uuidv4(),
        orderId,
        orderStatus: newStatus,
        updated_at: new Date(),
      });

      let notifType;
      if (newStatus==='Delivered') {
        notifType = CustomerNotificationTypes.ORDER_DELIVERED;
      } else if (newStatus==='Cancelled') {
        notifType = CustomerNotificationTypes.ORDER_CANCELED;
      } else {
        notifType = CustomerNotificationTypes.ORDER_STATUS_UPDATED;
      }
      await checkPreferencesAndSendNotificationToCustomer(customerId, notifType, {orderId, newStatus})

      return reply.send({ message: 'Order status updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update order status.' });
    }
  });

}
