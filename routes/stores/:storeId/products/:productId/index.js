'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, productId } = request.params;

    try {
      // Fetch the specific product
      const product = await knex('products')
          .where({ storeId, productId })
          .first();

      if (!product) {
        return reply.status(404).send({ error: 'Product not found.' });
      }

      // Fetch the collections the product belongs to
      product.collections = await knex('productCollections')
          .join('collections', 'productCollections.collectionId', 'collections.collectionId')
          .select('collections.collectionId', 'collections.collectionName')
          .where('productCollections.productId', productId);

      // Fetch variant information (if any)
      const productVariant = await knex('productVariants')
          .where({ productId })
          .first();

      if (productVariant) {
        // Fetch all variants in the same group, excluding the current product
        const variantGroupId = productVariant.variantGroupId;
        const variants = await knex('productVariants')
            .join('products', 'productVariants.productId', 'products.productId')
            .select(
                'products.productId',
                'products.productName',
                'products.price',
                'products.stock',
                'productVariants.differingAttributes'
            )
            .where('productVariants.variantGroupId', variantGroupId)
            .andWhereNot('productVariants.productId', productId);

        // Attach variants to the product
        product.variants = variants;
      } else {
        product.variants = []; // No variants if not part of a variant group
      }

      return reply.send(product);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch product details.' });
    }
  });

  fastify.patch('/', async (request, reply) => {
    const { storeId, productId } = request.params;
    const updates = request.body; // JSON body containing fields to update

    try {
      // Update the product
      const result = await knex('products')
          .where({ storeId, productId })
          .update(updates);

      if (!result) {
        return reply.status(404).send({ error: 'Product not found or not updated.' });
      }

      return reply.send({ message: 'Product updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update product.' });
    }
  });

}
