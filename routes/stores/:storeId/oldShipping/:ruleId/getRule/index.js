'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {

    fastify.get('/', async (request, reply) => {
        const { storeId, ruleId } = request.params;

        try {
            const rule = await knex('shipping_rules')
                .where({
                    ruleId,
                    storeId
                })
                .first();

            if (!rule) {
                return reply.status(404).send({
                    error: 'Shipping rule not found'
                });
            }

            return reply.send(rule);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                error: 'Failed to fetch shipping rule'
            });
        }
    });



}