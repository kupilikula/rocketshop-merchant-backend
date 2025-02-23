'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const { storeId } = request.params;
        const {
            ruleName,
            baseCost,
            formula,
            conditions,
            priority,
            isActive = true,
        } = request.body;

        try {
            // Input validation
            if (!ruleName || !baseCost || !formula || !conditions) {
                return reply.status(400).send({ error: 'Missing required shipping rule fields.' });
            }

            const ruleId = uuidv4();

            // Get the highest priority and add 1 for the new rule if priority not specified
            if (priority === undefined) {
                const highestPriority = await knex('shipping_rules')
                    .where({ storeId })
                    .max('priority as maxPriority')
                    .first();

                priority = (highestPriority?.maxPriority || 0) + 1;
            }

            // Insert the new shipping rule
            const [newRule] = await knex('shipping_rules')
                .insert({
                    ruleId,
                    storeId,
                    ruleName,
                    baseCost,
                    conditions: JSON.stringify(conditions),
                    priority,
                    isActive,
                    created_at: new Date(),
                    updated_at: new Date(),
                })
                .returning('*');

            return reply.send({
                message: 'Shipping rule created successfully.',
                rule: newRule,
            });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create shipping rule.' });
        }
    });

}