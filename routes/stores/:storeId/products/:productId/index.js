'use strict'

const knex = require("@database/knexInstance");
const {v4: uuidv4} = require("uuid");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// Configure S3 client (DigitalOcean Spaces)
const s3Client = new S3Client({
  endpoint: 'https://blr1.digitaloceanspaces.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SPACES_SECRET_KEY,
  },
});

const BUCKET_NAME = process.env.SPACES_BUCKET_NAME;

async function deleteProductMedia(storeId, productId) {
  const prefix = `stores/${storeId}/products/${productId}/`;

  const listedObjects = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
  }));

  if (listedObjects.Contents && listedObjects.Contents.length > 0) {
    const deleteParams = {
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key })),
        Quiet: false,
      },
    };
    await s3Client.send(new DeleteObjectsCommand(deleteParams));
  }
}

async function deleteProductFromDb(storeId, productId) {
  await knex('products')
      .where({ storeId, productId })
      .del();
}


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

    try {
      // Ensure the product exists and belongs to the store
      const product = await knex('products')
          .where({ productId, storeId })
          .first();

      if (!product) {
        return reply.status(404).send({ error: 'Product not found.' });
      }

      let {
        collections: updatedCollections = [],
        shippingRuleDraft,
        shippingRuleChoice,
        ...updatedData
      } = request.body;

      if (updatedData.mediaItems) {
        delete updatedData.mediaItems;
      }

      // Update the product in the database
      const updatedRows = await knex('products')
          .where({ productId, storeId })
          .update({
            ...updatedData,
            attributes: JSON.stringify(updatedData.attributes),
            productTags: JSON.stringify(updatedData.productTags),
            updated_at: new Date(),
          });

      if (!updatedRows) {
        return reply.status(500).send({ error: 'Failed to update product.' });
      }

      // Update the productCollections table
      const existingCollections = await knex('productCollections')
          .where({ productId })
          .pluck('collectionId');

      // Collections to add
      const collectionsToAdd = updatedCollections.filter(
          (collectionId) => !existingCollections.includes(collectionId)
      );

      // Collections to remove
      const collectionsToRemove = existingCollections.filter(
          (collectionId) => !updatedCollections.includes(collectionId)
      );

      // Remove collections
      if (collectionsToRemove.length > 0) {
        await knex('productCollections')
            .where({ productId })
            .whereIn('collectionId', collectionsToRemove)
            .del();
      }

      // Add new collections with computed displayOrder
      if (collectionsToAdd.length > 0) {
        const productCollectionsData = [];

        for (const collectionId of collectionsToAdd) {
          // Fetch the current maximum displayOrder for the collection
          const maxDisplayOrder = await knex('productCollections')
              .where({ collectionId })
              .max('displayOrder as maxOrder')
              .first();

          // Set the displayOrder to the next available position (last index + 1)
          const displayOrder = (maxDisplayOrder?.maxOrder || 0) + 1;

          productCollectionsData.push({
            productId,
            collectionId,
            displayOrder,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }

        await knex('productCollections').insert(productCollectionsData);
      }

      // 🚚 Update or clone shipping rule if required
      if (shippingRuleDraft && shippingRuleChoice) {
        if (shippingRuleChoice === 'editAll') {
          // Update existing rule (get ruleId from association)
          const currentRule = await knex('product_shipping_rules')
              .where({ productId })
              .first();

          if (currentRule) {
            await knex('shipping_rules')
                .where({ shippingRuleId: currentRule.shippingRuleId })
                .update({
                  ruleName: shippingRuleDraft.ruleName,
                  conditions: JSON.stringify(shippingRuleDraft.conditions),
                  groupingEnabled: shippingRuleDraft.groupingEnabled,
                  is_international_shipping_enabled: shippingRuleDraft.is_international_shipping_enabled,
                  isActive: true,
                  updated_at: new Date(),
                });
          }
        } else if (shippingRuleChoice === 'editOnlyThis') {
          const newShippingRuleId = uuidv4();
          await knex('shipping_rules').insert({
            shippingRuleId: newShippingRuleId,
            storeId,
            ruleName: shippingRuleDraft.ruleName,
            conditions: JSON.stringify(shippingRuleDraft.conditions),
            groupingEnabled: false, // forced off for product-specific rules
            is_international_shipping_enabled: shippingRuleDraft.is_international_shipping_enabled || false,
            isActive: true,
            created_at: new Date(),
            updated_at: new Date(),
          });

          await knex('product_shipping_rules')
              .where({ productId })
              .delete();

          await knex('product_shipping_rules').insert({
            assignmentId: uuidv4(),
            productId,
            shippingRuleId: newShippingRuleId,
            created_at: new Date(),
            updated_at: new Date(),
          });
        } else if (shippingRuleChoice === 'assignExisting' && shippingRuleDraft?.shippingRuleId) {
          const shippingRuleId = shippingRuleDraft.shippingRuleId;

          // ✅ Validate that the rule exists and belongs to the same store
          const validRule = await knex('shipping_rules')
              .where({ shippingRuleId, storeId })
              .first();

          if (!validRule) {
            return reply.status(400).send({ error: 'Invalid shipping rule selected.' });
          }

          const existingAssignment = await knex('product_shipping_rules')
              .where({ productId })
              .first();

          if (existingAssignment) {
            await knex('product_shipping_rules')
                .where({ productId })
                .update({ shippingRuleId, updated_at: new Date() });
          } else {
            await knex('product_shipping_rules').insert({
              assignmentId: uuidv4(),
              productId,
              shippingRuleId,
              created_at: new Date(),
              updated_at: new Date(),
            });
          }
        }
      }

      return reply.send({ message: 'Product updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update product.' });
    }
  });

}
