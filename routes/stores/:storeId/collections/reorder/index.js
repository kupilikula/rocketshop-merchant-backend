'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.patch('/', async (request, reply) => {
    const { storeId } = request.params;
    const { collectionOrders } = request.body; // Example: [{ collectionId: 1, displayOrder: 2 }, ...]

    try {
      // Update displayOrder for collections
      const updatePromises = collectionOrders.map(({ collectionId, displayOrder }) =>
          knex('collections')
              .where({ collectionId, storeId })
              .update({ displayOrder })
      );

      await Promise.all(updatePromises);

      return reply.send({ message: 'Collection order updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update collection order.' });
    }
  });

}
