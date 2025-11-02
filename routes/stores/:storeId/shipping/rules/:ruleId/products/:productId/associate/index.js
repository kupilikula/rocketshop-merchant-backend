// routes/productShippingRules.js
'use strict';

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {

    fastify.patch('/', async (request, reply) => {
        const { storeId, ruleId, productId} = request.params;

        try {
            // Check if product exists
            const product = await knex('products')
                .where({ productId })
                .first();

            if (!product) {
                return reply.code(404).send({ error: 'Product not found' });
            }

            // Case of No Shipping Required
            if (ruleId === 'NoShippingRequired') {
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
                        is_international_shipping_enabled: true,
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
                    .where({ productId })
                    .first();

                if (existingAssignment) {
                    // Optional: update to new rule
                    await knex('product_shipping_rules')
                        .where({ productId })
                        .update({
                            shippingRuleId: rule.shippingRuleId,
                            updated_at: new Date(),
                        });
                } else {
                    const assignmentId = uuidv4();
                    await knex('product_shipping_rules').insert({
                        assignmentId,
                        productId,
                        shippingRuleId: rule.shippingRuleId,
                        created_at: new Date(),
                        updated_at: new Date(),
                    });
                    return { assignmentId };
                }
                return { assignmentId: existingAssignment.assignmentId };

            } else {

                // Check if shipping rule exists
                const rule = await knex('shipping_rules')
                    .where({ shippingRuleId: ruleId })
                    .first();

                if (!rule) {
                    return reply.code(404).send({ error: 'Shipping rule not found' });
                }

                // Delete any existing association (only one allowed per product)
                await knex('product_shipping_rules')
                    .where({ productId })
                    .del();

                // Create new association
                const assignmentId = uuidv4();
                const now = new Date();

                await knex('product_shipping_rules').insert({
                    assignmentId,
                    productId,
                    shippingRuleId: ruleId,
                    created_at: now,
                    updated_at: now
                });
                return { assignmentId };

            }




        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to associate shipping rule' });
        }
    });
};