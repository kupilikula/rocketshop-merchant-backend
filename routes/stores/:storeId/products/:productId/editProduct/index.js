'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.put('/', async (request, reply) => {
    const { storeId, productId } = request.params;
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
      isActive,
    } = request.body;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Ensure the product exists and belongs to the store
      const product = await knex('products')
          .where({ productId, storeId })
          .first();

      if (!product) {
        return reply.status(404).send({ error: 'Product not found.' });
      }

      // Update the product in the database
      const updatedRows = await knex('products')
          .where({ productId, storeId })
          .update({
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
            updated_at: new Date(),
          });

      if (!updatedRows) {
        return reply.status(500).send({ error: 'Failed to update product.' });
      }

      return reply.send({ message: 'Product updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update product.' });
    }
  });
}
