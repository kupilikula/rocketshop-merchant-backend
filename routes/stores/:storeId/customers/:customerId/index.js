'use strict'

const knex = require("@database/knexInstance");

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

      // Fetch order history for the store
      const orders = await knex('orders')
          .where({ customerId, storeId })
          .orderBy('orderDate', 'desc');

      return reply.send({ ...customer, orders });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customer details.' });
    }
  });

}
