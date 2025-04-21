'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, orderId } = request.params;

    try {
      // Fetch the status history
      const history = await knex('order_status_history')
          .where({ orderId })
          .orderBy('updated_at', 'desc');

      return reply.send(history);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch order status history.' });
    }
  });

}
