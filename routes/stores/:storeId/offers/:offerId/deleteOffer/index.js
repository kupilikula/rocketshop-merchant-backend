'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.delete('/', async (request, reply) => {
    const { storeId, offerId } = request.params;

    try {
      // Check if the offer exists
      const offer = await knex('offers')
          .where({ storeId, offerId })
          .first();

      if (!offer) {
        return reply.status(404).send({ error: 'Offer not found.' });
      }

      // Delete the offer
      await knex('offers')
          .where({ storeId, offerId })
          .del();

      return reply.send({ message: 'Offer deleted successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete offer.' });
    }
  });

}
