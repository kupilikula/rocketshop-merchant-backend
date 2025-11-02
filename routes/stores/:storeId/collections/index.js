'use strict'

const knex = require("@database/knexInstance");
const {v4: uuidv4} = require("uuid");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Fetch all collections for the store
      const collections = await knex('collections')
          .where({ storeId })
          .orderBy('displayOrder', 'asc'); // Fetch all fields and order by displayOrder


      // Fetch product counts for each collection
      let productCounts = []
      if (collections.length > 0) {
         productCounts = await knex('productCollections')
            .join('products', 'productCollections.productId', 'products.productId')
            .select(
                'productCollections.collectionId',
                knex.raw('SUM(CASE WHEN "products"."isActive" THEN 1 ELSE 0 END) as "activeProducts"'),
                knex.raw('SUM(CASE WHEN NOT "products"."isActive" THEN 1 ELSE 0 END) as "inactiveProducts"')
            )
            .whereIn('productCollections.collectionId', collections.map((c) => c.collectionId))
            .groupBy('productCollections.collectionId');
      }

      // Map product counts into the collections
      const collectionsWithCounts = collections.map((collection) => {
        const productCount = productCounts.find(
            (count) => count.collectionId === collection.collectionId
        ) || { activeProducts: 0, inactiveProducts: 0 };

        return {
          ...collection,
          activeProducts: parseInt(productCount.activeProducts, 10),
          inactiveProducts: parseInt(productCount.inactiveProducts, 10),
        };
      });

      return reply.send(collectionsWithCounts);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch collections.' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const { collectionName, isActive = false, storeFrontDisplay = true, storeFrontDisplayNumberOfItems = 6 } = request.body;

    try {
      const collectionId = uuidv4();

      const [newCollection] = await knex("collections")
          .insert({
            collectionId,
            storeId,
            collectionName,
            isActive,
            storeFrontDisplay,
            storeFrontDisplayNumberOfItems,
            displayOrder: 0
          })
          .returning("*"); // Returning inserted row (PostgreSQL)

      return reply.code(201).send({ success: true, data: newCollection });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, message: "Failed to create collection" });
    }
  });
}