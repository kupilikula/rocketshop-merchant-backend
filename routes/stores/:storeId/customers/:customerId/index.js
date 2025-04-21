'use strict';

const knex = require("@database/knexInstance");
const { getCompletedOrderStatuses } = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, customerId } = request.params;

    try {
      // Fetch customer profile
      const customer = await knex('customers')
          .where({ customerId })
          .first();

      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found.' });
      }

      // Fetch all orders for this customer at this store
      const orders = await knex('orders')
          .where({ customerId, storeId })
          .orderBy('orderDate', 'desc');

      const completedStatuses = getCompletedOrderStatuses();

      // Aggregate stats from completed orders only
      const completedOrders = orders.filter(o => completedStatuses.includes(o.orderStatus));
      const totalSpent = completedOrders.reduce((sum, o) => sum + Number(o.orderTotal), 0);
      const orderCount = completedOrders.length;
      const mostRecentOrderDate = completedOrders.length > 0
          ? completedOrders[0].orderDate
          : null;

      return reply.send({
        ...customer,
        orders,
        totalSpent,
        orderCount,
        mostRecentOrderDate,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customer details.' });
    }
  });
};