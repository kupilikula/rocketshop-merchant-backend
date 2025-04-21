'use strict';

const knex = require("@database/knexInstance");
const { getSalesEligibleOrderStatuses } = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;
    if (!storeId) return reply.status(400).send({ error: "Missing storeId" });

    try {
      const salesEligibleOrderStatuses = getSalesEligibleOrderStatuses();

      const customers = await knex('orders as o')
          .where('o.storeId', storeId)
          .groupBy('o.customerId', 'c.customerId')
          .select(
              'c.*',
              // Count of *all* orders for the customer at this store
              knex.raw('COUNT(o."orderId") AS "orderCount"'),

              // Count only sales-eligible orders using FILTER
              knex.raw(`COUNT(o."orderId") FILTER (WHERE o."orderStatus" = ANY(?)) AS "salesEligibleOrderCount"`, [salesEligibleOrderStatuses]),

              // Total spent only from sales-eligible orders
              knex.raw(`SUM(CASE WHEN o."orderStatus" = ANY(?) THEN o."orderTotal" ELSE 0 END)::float AS "totalSpent"`, [salesEligibleOrderStatuses]),

              // Most recent order date from sales-eligible orders
              knex.raw(`MAX(CASE WHEN o."orderStatus" = ANY(?) THEN o."orderDate" ELSE NULL END) AS "mostRecentOrderDate"`, [salesEligibleOrderStatuses])
          )
          .join('customers as c', 'o.customerId', 'c.customerId')
          .orderBy('mostRecentOrderDate', 'desc');

      return reply.send(customers);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customers.' });
    }
  });
};