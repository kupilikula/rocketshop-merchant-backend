'use strict';

const knex = require("@database/knexInstance");
const { getSalesEligibleOrderStatuses} = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;
    if (!storeId) return reply.status(400).send({ error: "Missing storeId" });

    try {
      const salesEligibleOrderStatuses = getSalesEligibleOrderStatuses();

      const customers = await knex('orders as o')
          .where('o.storeId', storeId)
          .whereIn('o.orderStatus', salesEligibleOrderStatuses)
          .groupBy('o.customerId', 'c.customerId')
          .select(
              'c.*',
              knex.raw('SUM(o."orderTotal")::float AS "totalSpent"'),
              knex.raw('COUNT(o."orderId") AS "orderCount"'),
              knex.raw('MAX(o."orderDate") AS "mostRecentOrderDate"')
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