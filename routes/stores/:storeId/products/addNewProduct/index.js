'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      const newProduct = request.body
      const insertProduct = {
          ...newProduct,
          attributes: JSON.stringify(newProduct.attributes),
          mediaItems: JSON.stringify(newProduct.mediaItems),
          productTags: JSON.stringify(newProduct.productTags),
          created_at: new Date(),
          updated_at: new Date(),
      }

      // Insert the new product into the database
      const insertedProductId = await knex('products')
          .insert(insertProduct);

      return reply.send({ message: 'Product added successfully.', productId: insertedProductId });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

}
