'use strict';
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const { productId, parentProductId, differingAttributes } = request.body;

        try {
            // Validate the input
            if (!productId || !parentProductId || !differingAttributes) {
                return reply.status(400).send({
                    error: "Missing required fields: productId, parentProductId, or differingAttributes.",
                });
            }

            // Fetch parent product
            const parentProduct = await knex("products").where({ productId: parentProductId }).first();
            if (!parentProduct) {
                return reply.status(404).send({ error: "Parent product does not exist." });
            }

            // Fetch the product to be marked
            const productToMark = await knex("products").where({ productId }).first();
            if (!productToMark) {
                return reply.status(404).send({ error: "Product to be marked does not exist." });
            }

            // Check if the parent product is already part of a variant group
            const parentVariant = await knex("productVariants").where({ productId: parentProductId }).first();

            let variantGroupId;

            if (parentVariant) {
                // Use the existing variant group
                variantGroupId = parentVariant.variantGroupId;
            } else {
                // Create a new variant group
                const [newGroup] = await knex("variantGroups").insert(
                    {
                        variantGroupId: uuidv4(), // Use Knex's raw function for UUID generation
                        storeId: parentProduct.storeId,
                        name: `Variant Group for ${parentProduct.productName}`,
                    },
                    ["variantGroupId"]
                );

                variantGroupId = newGroup.variantGroupId;

                // Compute parent product's differing attributes (with parent product values)
                const parentDifferingAttributes = differingAttributes.map(({ key }) => {
                    const parentValue = (parentProduct.attributes || []).find(
                        (attr) => attr.key === key
                    )?.value;
                    return { key, value: parentValue || null };
                });

                // Add parent product to the new group
                await knex("productVariants").insert({
                    productVariantId: uuidv4(),
                    productId: parentProductId,
                    variantGroupId,
                    differingAttributes: JSON.stringify(parentDifferingAttributes),
                });
            }

            // Compute differing attributes for the product to mark
            const productDifferingAttributes = differingAttributes.map(({ key, value }) => ({
                key,
                value,
            }));

            // Add the product to the variant group
            await knex("productVariants").insert({
                productVariantId: uuidv4(),
                productId,
                variantGroupId,
                differingAttributes: JSON.stringify(productDifferingAttributes),
            });

            return reply.status(200).send({ message: "Product successfully marked as a variant." });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: "An error occurred while marking the product as a variant." });
        }
    });
};