'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;

    try {
      // Fetch collection details
      const collection = await knex('collections')
          .where({ collectionId, storeId })
          .first();

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found.' });
      }

      // Fetch products in the collection using productCollections table
      const products = await knex('productCollections')
          .join('products', 'productCollections.productId', 'products.productId')
          .where({ 'productCollections.collectionId': collectionId })
          .select(
              'products.*',
              'productCollections.displayOrder'
          )
          .orderBy('productCollections.displayOrder', 'asc');

      return reply.send({ ...collection, products });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch collection details.' });
    }
  });
  fastify.patch('/', async (request, reply) => {
    const { storeId, collectionId } = request.params;
    const updates = request.body; // JSON body containing the updates (e.g., isActive, storeFrontDisplay)

    try {
      // Update collection settings
      const result = await knex('collections')
          .where({ collectionId, storeId })
          .update(updates);

      if (!result) {
        return reply.status(404).send({ error: 'Collection not found or not updated.' });
      }

      return reply.send({ message: 'Collection updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update collection settings.' });
    }
  });
// Utility function to validate merchant's access to the store
}
