'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {

    // Update priorities (reordering)
    fastify.put('/', async (request, reply) => {
        const { storeId } = request.params;
        const { ruleOrders } = request.body; // Array of { ruleId, priority }

        if (!Array.isArray(ruleOrders)) {
            return reply.status(400).send({ error: 'Invalid rule orders format.' });
        }

        try {
            await knex.transaction(async (trx) => {
                for (const { ruleId, priority } of ruleOrders) {
                    await trx('shipping_rules')
                        .where({ ruleId, storeId })
                        .update({ priority, updated_at: new Date() });
                }
            });

            const updatedRules = await knex('shipping_rules')
                .where({ storeId })
                .orderBy('priority', 'asc')
                .select('*');

            return reply.send({
                message: 'Shipping rules reordered successfully.',
                rules: updatedRules,
            });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to reorder shipping rules.' });
        }
    });


}