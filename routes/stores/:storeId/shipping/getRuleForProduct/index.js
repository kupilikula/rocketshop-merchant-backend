'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const { productId } = request.query;

        if (!productId) {
            return reply.code(400).send({ error: 'Missing productId' });
        }

        const rule = await knex('shipping_rules as sr')
            .join('product_shipping_rules as psr', 'sr.shippingRuleId', 'psr.shippingRuleId')
            .where('psr.productId', productId)
            .select(
                'sr.shippingRuleId',
                'sr.storeId',
                'sr.ruleName',
                'sr.conditions',
                'sr.groupingEnabled',
                'sr.is_international_shipping_enabled',
                'sr.isActive',
                'sr.created_at',
                'sr.updated_at'
            )
            .first();

        if (!rule) {
            return reply.code(404).send({ error: 'No shipping rule found for this product' });
        }

        // Count how many products use this rule
        const { count } = await knex('product_shipping_rules')
            .where('shippingRuleId', rule.shippingRuleId)
            .count('productId as count')
            .first();

        return reply.status(200).send({
            ...rule,
            usageCount: Number(count) || 0,
        });
    });
};