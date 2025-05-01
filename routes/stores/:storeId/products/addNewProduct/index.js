'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      const newProduct = request.body
      const collectionIds = newProduct.collections;
      const variantInfo = newProduct.variantInfo || undefined;
      const shipping = newProduct.shipping || {};

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
      delete insertProduct.shipping;

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
                        variantGroupId: uuidv4(),
                        storeId,
                        name: `Variant Group for ${parentProduct.productName}`,
                    },
                    ["variantGroupId"]
                );

                variantGroupId = newGroup.variantGroupId;

                // Compute parent product's differing attributes
                const parentDifferingAttributes = differingAttributes.map(({ key }) => {
                    const parentValue = parentProduct.attributes.find((attr) => attr.key === key)?.value;
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

            // Add the new product to the variant group
            await knex("productVariants").insert({
                productVariantId: uuidv4(),
                productId: newProduct.productId,
                variantGroupId,
                differingAttributes: JSON.stringify(differingAttributes),
            });
        }

        if (shipping.shippingRuleChoice==='createNew' || shipping.shippingRuleChoice==='cloneExisting') {
            const {
                ruleName,
                conditions,
                groupingEnabled,
                isActive
            } = shipping.newShippingRule;

            if (!Array.isArray(conditions) || conditions.length === 0) {
                return reply.code(400).send({
                    success: false,
                    error: 'Missing required fields in shipping rule: conditions must be provided.'
                });
            }

            // Validate fallback condition
            const fallback = conditions.find(c => Array.isArray(c.when) && c.when.length === 0);

            if (!fallback) {
                return reply.code(400).send({
                    success: false,
                    error: 'Must include a fallback condition with when: [].'
                });
            }

            if (fallback.baseCost === undefined || !fallback.costModifiers) {
                return reply.code(400).send({
                    success: false,
                    error: 'Fallback condition must include baseCost and costModifiers.'
                });
            }

            const shippingRuleId = uuidv4();

            try {
                await knex('shipping_rules').insert({
                    shippingRuleId,
                    storeId,
                    ruleName,
                    groupingEnabled: groupingEnabled || false,
                    conditions: JSON.stringify(conditions),
                    isActive: isActive !== false,
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now(),
                });


                // Delete any existing association (only one allowed per product)
                await knex('product_shipping_rules')
                    .where({ productId: newProduct.productId })
                    .del();

                // Create new association
                const assignmentId = uuidv4();
                const now = new Date();

                await knex('product_shipping_rules').insert({
                    assignmentId,
                    productId: newProduct.productId,
                    shippingRuleId,
                    created_at: now,
                    updated_at: now
                });

            } catch (error) {
                console.error('Error creating shipping rule:', error);
                return reply.code(500).send({
                    success: false,
                    error: 'Internal Server Error',
                });
            }
        } else if (shipping.shippingRuleChoice==='useExisting') {

            // Check if shipping rule exists
            const rule = await knex('shipping_rules')
                .where({ shippingRuleId: shipping.selectedExistingShippingRuleId })
                .first();

            if (!rule) {
                return reply.code(404).send({ error: 'Shipping rule not found' });
            }

            // Delete any existing association (only one allowed per product)
            await knex('product_shipping_rules')
                .where({ productId: newProduct.productId })
                .del();

            // Create new association
            const assignmentId = uuidv4();
            const now = new Date();

            await knex('product_shipping_rules').insert({
                assignmentId,
                productId: newProduct.productId,
                shippingRuleId: shipping.selectedExistingShippingRuleId,
                created_at: now,
                updated_at: now
            });
        } else if (shipping.shippingRuleChoice==='noShipping') {

            // Check if rule already exists
            let rule = await knex('shipping_rules')
                .where({ storeId, ruleName: 'No Shipping', isActive: true })
                .first();

            if (!rule) {
                const newShippingRuleId = uuidv4();
                const timestamps = { created_at: new Date(), updated_at: new Date() };

                rule = {
                    shippingRuleId: newShippingRuleId,
                    storeId,
                    ruleName: 'No Shipping',
                    groupingEnabled: true,
                    isActive: true,
                    conditions: JSON.stringify([
                        {
                            when: [],
                            baseCost: 0,
                            costModifiers: {
                                extraPerItemEnabled: false,
                                discountEnabled: false,
                                capEnabled: false,
                            },
                        },
                    ]),
                    ...timestamps,
                };

                await knex('shipping_rules').insert(rule);
            }

            const existingAssignment = await knex('product_shipping_rules')
                .where({ productId: newProduct.productId})
                .first();

            if (existingAssignment) {
                // Optional: update to new rule
                await knex('product_shipping_rules')
                    .where({ productId: newProduct.productId })
                    .update({
                        shippingRuleId: rule.shippingRuleId,
                        updated_at: new Date(),
                    });
            } else {
                const assignmentId = uuidv4();
                await knex('product_shipping_rules').insert({
                    assignmentId,
                    productId: newProduct.productId,
                    shippingRuleId: rule.shippingRuleId,
                    created_at: new Date(),
                    updated_at: new Date(),
                });
            }
        }

      return reply.send({ message: 'Product added successfully.'});
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

}
