'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Fetch all offers for the store
      const offers = await knex('offers')
          .where({ storeId })

      return reply.send(offers);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch offers.' });
    }
  });

}
