'use strict';

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
    fastify.put('/', async (request, reply) => {
        const { storeId, productId } = request.params;

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

            let updatedData = request.body;
            const updatedCollections = updatedData.collections || [];
            delete updatedData.collections; // Remove collections from updatedData

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

            return reply.send({ message: 'Product updated successfully.' });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update product.' });
        }
    });
};