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
      const collectionIds = newProduct.collections;

      const insertProduct = {
          ...newProduct,
          storeId:  storeId,
          attributes: JSON.stringify(newProduct.attributes),
          mediaItems: JSON.stringify(newProduct.mediaItems),
          productTags: JSON.stringify(newProduct.productTags),
          created_at: new Date(),
          updated_at: new Date(),
      }
      delete insertProduct.collections;

      // Insert the new product into the database
      const [insertedProductId] = await knex('products')
          .insert(insertProduct);

      // Insert rows in the productCollections table
        if (Array.isArray(collectionIds) && collectionIds.length > 0) {
            const productCollectionsData = [];

            for (const collectionId of collectionIds) {
                // Fetch the current maximum displayOrder for the collection
                const maxDisplayOrder = await knex('productCollections')
                    .where({ collectionId })
                    .max('displayOrder as maxOrder')
                    .first();

                // Set the displayOrder to the next available position (last index + 1)
                const displayOrder = (maxDisplayOrder?.maxOrder || 0) + 1;

                productCollectionsData.push({
                    productId: newProduct.productId,
                    collectionId,
                    displayOrder,
                    created_at: new Date(),
                    updated_at: new Date(),
                });
            }

            await knex('productCollections').insert(productCollectionsData);
        }


      return reply.send({ message: 'Product added successfully.', productId: insertedProductId });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

}
