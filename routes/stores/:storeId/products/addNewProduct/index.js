'use strict'

const knex = require("knex");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const {
      productName,
      description,
      price,
      stock,
      gstRate,
      gstInclusive,
      attributes = [],
      mediaItems = [],
      collectionIds = [],
      productTags = [],
      isActive = true,
    } = request.body;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Insert the new product into the database
      const [newProductId] = await knex('products')
          .insert({
            storeId,
            productName,
            description,
            price,
            stock,
            gstRate,
            gstInclusive,
            attributes: JSON.stringify(attributes),
            mediaItems: JSON.stringify(mediaItems),
            collectionIds: JSON.stringify(collectionIds),
            productTags: JSON.stringify(productTags),
            isActive,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning('productId'); // Return the ID of the newly created product

      return reply.send({ message: 'Product added successfully.', productId: newProductId });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

// Utility function to validate merchant's access to the store
  async function validateMerchantAccessToStore(merchantId, storeId) {
    const store = await knex('stores')
        .where({ storeId, merchantId })
        .first();
    return !!store;
  }
}
