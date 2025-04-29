'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {

    fastify.delete('/', async (request, reply) => {
        const { storeId, ruleId } = request.params;

        try {
            const deleted = await knex('shipping_rules')
                .where({ ruleId, storeId })
                .delete();

            if (!deleted) {
                return reply.status(404).send({ error: 'Shipping rule not found.' });
            }

            // Reorder remaining rules to ensure no gaps in priority
            const remainingRules = await knex('shipping_rules')
                .where({ storeId })
                .orderBy('priority', 'asc')
                .select('*');

            await knex.transaction(async (trx) => {
                for (let i = 0; i < remainingRules.length; i++) {
                    await trx('shipping_rules')
                        .where({ ruleId: remainingRules[i].ruleId })
                        .update({ priority: i + 1 });
                }
            });

            return reply.send({ message: 'Shipping rule deleted successfully.' });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete shipping rule.' });
        }
    });



}