const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.delete('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;

        await knex('merchantStores')
            .where({ storeId, merchantId })
            .del();

        return reply.status(200).send({ success: true });
    });
};