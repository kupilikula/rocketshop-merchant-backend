// routes/productShippingRules.js
'use strict';

const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    const knex = fastify.knex;

    fastify.post('/', async (request, reply) => {
        const { productId, shippingRuleId } = request.body;

        try {
            // Check if product exists
            const product = await knex('products')
                .where({ productId })
                .first();

            if (!product) {
                return reply.code(404).send({ error: 'Product not found' });
            }

            // Check if shipping rule exists
            const rule = await knex('shipping_rules')
                .where({ shippingRuleId })
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
                shippingRuleId,
                created_at: now,
                updated_at: now
            });

            return { assignmentId };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to associate shipping rule' });
        }
    });
};