const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const { role } = request.body;

        if (!role) {
            return reply.status(400).send({ error: 'Missing role' });
        }

        await knex('merchantStores')
            .where({ storeId, merchantId })
            .update({
                role,
                updated_at: knex.fn.now(),
            });

        return reply.status(200).send({ success: true });
    });
};