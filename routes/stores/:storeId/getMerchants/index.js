const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;

        const merchants = await knex('merchantStores')
            .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
            .where('merchantStores.storeId', storeId)
            .select(
                'merchants.*',
                'merchants.phone',
                'merchantStores.role',
                'merchantStores.canReceiveMessages'
            );

        return reply.send({ merchants });
    });
};