'use strict';

const knex = require("@database/knexInstance");
const { getCompletedOrderStatuses } = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    if (!storeId) return reply.status(400).send({ error: "Missing storeId" });

    try {
      const completedStatuses = getCompletedOrderStatuses();

      // Subquery: aggregate totalSpent, orderCount, mostRecentOrderDate per customer
      const customerStats = knex('orders')
          .where({ storeId })
          .whereIn('orderStatus', completedStatuses)
          .groupBy('customerId')
          .select('customerId')
          .sum({ totalSpent: 'orderTotal' })
          .count({ orderCount: 'orderId' })
          .max('orderDate as mostRecentOrderDate')
          .as('stats');

      // Join with customer details
      const customers = await knex
          .select('c.*', 'stats.totalSpent', 'stats.orderCount', 'stats.mostRecentOrderDate')
          .from('customers as c')
          .leftJoin(customerStats, 'c.customerId', 'stats.customerId') // LEFT JOIN ensures we include customers with 0 orders
          .orderBy('stats.mostRecentOrderDate', 'desc');

      return reply.send(customers);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customers.' });
    }
  });
};