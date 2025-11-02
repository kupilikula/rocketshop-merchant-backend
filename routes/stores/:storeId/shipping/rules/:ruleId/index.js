'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { shippingRuleId } = request.params;
        const {
            ruleName,
            groupingEnabled,
            is_international_shipping_enabled,
            isActive,
            conditions,
        } = request.body;

        if (!ruleName || !Array.isArray(conditions)) {
            return reply.code(400).send({ error: 'Invalid input: ruleName and conditions are required.' });
        }

        try {
            const existing = await knex('shipping_rules')
                .where({ shippingRuleId })
                .first();

            if (!existing) {
                return reply.code(404).send({ error: 'Shipping rule not found.' });
            }

            await knex('shipping_rules')
                .where({ shippingRuleId })
                .update({
                    ruleName,
                    groupingEnabled: groupingEnabled ?? existing.groupingEnabled,
                    is_international_shipping_enabled: is_international_shipping_enabled ?? existing.is_international_shipping_enabled,
                    isActive: isActive ?? existing.isActive,
                    conditions: JSON.stringify(conditions),
                    updated_at: new Date(),
                });

            return reply.code(200).send({ success: true });
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to update shipping rule.' });
        }
    });
};