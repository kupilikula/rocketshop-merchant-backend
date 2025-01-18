'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Fetch store details
      const store = await knex('stores')
          .where({ storeId })
          .first(); // Fetch all fields

      if (!store) {
        return reply.status(404).send({ error: 'Store not found.' });
      }

      // Fetch collections for the store
      const collections = await knex('collections')
          .where({ storeId, isActive: true }) // Only active collections
          .orderBy('displayOrder', 'asc'); // Fetch all fields

      for (const collection of collections) {
        // Fetch products for each collection
        // Fetch products in the collection using productCollections table
        let products = await knex('productCollections')
            .join('products', 'productCollections.productId', 'products.productId')
            .where({'productCollections.collectionId': collection.collectionId, isActive: true})
            .orderBy('productCollections.displayOrder', 'asc');

        collection.numberOfActiveProducts = products.length;
        collection.displayProducts = products.slice(0, collection.storeFrontDisplayNumberOfItems);

      }

      return reply.send({ ...store, collections });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch store front data.' });
    }
  });

}
