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
      const variantInfo = newProduct.variantInfo || undefined;

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
      delete insertProduct.variantInfo;

      // Insert the new product into the database
      await knex('products')
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

        // Handle variant functionality if provided
        if (variantInfo) {
            const { parentProductId, differingAttributes } = variantInfo;

            // Fetch parent product
            const parentProduct = await knex("products").where({ productId: parentProductId }).first();
            if (!parentProduct) {
                return res.status(400).json({ error: "Parent product does not exist." });
            }

            // Fetch parent product's variant group (if it exists)
            const parentVariant = await knex("productVariants")
                .where({ productId: parentProductId })
                .first();

            let variantGroupId;

            if (parentVariant) {
                // Use the existing variant group
                variantGroupId = parentVariant.variantGroupId;
            } else {
                // Create a new variant group
                const [newGroup] = await knex("variantGroups").insert(
                    {
                        variantGroupId: knex.raw("uuid_generate_v4()"),
                        storeId,
                        name: `Variant Group for ${parentProduct.productName}`,
                    },
                    ["variantGroupId"]
                );

                variantGroupId = newGroup.variantGroupId;

                // Compute parent product's differing attributes
                const parentDifferingAttributes = differingAttributes.map(({ key }) => {
                    const parentValue = JSON.parse(parentProduct.attributes).find((attr) => attr.key === key)?.value;
                    return { key, value: parentValue || null };
                });

                // Add parent product to the new group
                await knex("productVariants").insert({
                    productVariantId: knex.raw("uuid_generate_v4()"),
                    productId: parentProductId,
                    variantGroupId,
                    differingAttributes: JSON.stringify(parentDifferingAttributes),
                });
            }

            // Add the new product to the variant group
            await knex("productVariants").insert({
                productVariantId: knex.raw("uuid_generate_v4()"),
                productId: newProduct.productId,
                variantGroupId,
                differingAttributes: JSON.stringify(differingAttributes),
            });
        }


      return reply.send({ message: 'Product added successfully.'});
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

}
