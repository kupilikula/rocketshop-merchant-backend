fastify.get('/', async (request, reply) => {
  const { storeId, productId } = request.params;

  try {
    // Validate the merchant's access to the store (optional, based on your auth system)
    const merchantId = request.user.merchantId; // Assumes user data is attached to the request
    const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
    if (!hasAccess) {
      return reply.status(403).send({ error: 'Unauthorized access to this store.' });
    }

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