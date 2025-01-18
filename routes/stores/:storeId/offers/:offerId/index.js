'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, offerId } = request.params;

    try {
      // Fetch offer details
      const offer = await knex('offers')
          .where({ storeId, offerId })
          .first();

      if (!offer) {
        return reply.status(404).send({ error: 'Offer not found.' });
      }

      return reply.send(offer);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch offer details.' });
    }
  });


}
