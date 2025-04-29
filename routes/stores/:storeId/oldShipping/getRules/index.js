'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    // Get all shipping rules for a store
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;

        try {
            const rules = await knex('shipping_rules')
                .where({ storeId })
                .orderBy('priority', 'asc')
                .select('*');

            return reply.send(rules);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch shipping rules.' });
        }
    });

}