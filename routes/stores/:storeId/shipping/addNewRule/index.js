'use strict';

const { v4: uuidv4 } = require('uuid');
const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const {
            storeId,
            ruleName,
            conditions,
            groupingEnabled,
            isActive
        } = request.body;

        if (!storeId || !Array.isArray(conditions) || conditions.length === 0) {
            return reply.code(400).send({
                success: false,
                error: 'Missing required fields: storeId and conditions must be provided.'
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

            return reply.send({
                success: true,
                shippingRuleId,
            });
        } catch (error) {
            console.error('Error creating shipping rule:', error);
            return reply.code(500).send({
                success: false,
                error: 'Internal Server Error',
            });
        }
    });
};