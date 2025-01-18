'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {

  fastify.patch('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;
    const { productOrders } = request.body; // Example: [{ productId: 101, displayOrder: 1 }, ...]

    try {
      // Validate if the collection belongs to the store
      const collection = await knex('collections')
          .where({ collectionId, storeId })
          .first();

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found for this store.' });
      }

      // Update displayOrder for products in the collection
      const updatePromises = productOrders.map(({ productId, displayOrder }) =>
          knex('productCollections')
              .where({ collectionId, productId })
              .update({ displayOrder })
      );

      await Promise.all(updatePromises);

      return reply.send({ message: 'Product order updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update product order.' });
    }
  });

}
