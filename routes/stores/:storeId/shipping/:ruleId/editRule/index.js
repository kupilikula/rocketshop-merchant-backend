'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {

    fastify.put('/', async (request, reply) => {
        const { storeId, ruleId } = request.params;
        const {
            ruleName,
            ruleDisplayText,
            shippingCost,
            conditions,
            isActive,
        } = request.body;

        try {
            const [updatedRule] = await knex('shipping_rules')
                .where({ ruleId, storeId })
                .update({
                    ruleName,
                    ruleDisplayText,
                    shippingCost,
                    conditions: JSON.stringify(conditions),
                    isActive,
                    updated_at: new Date(),
                })
                .returning('*');

            if (!updatedRule) {
                return reply.status(404).send({ error: 'Shipping rule not found.' });
            }

            return reply.send({
                message: 'Shipping rule updated successfully.',
                rule: updatedRule,
            });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update shipping rule.' });
        }
    });


}