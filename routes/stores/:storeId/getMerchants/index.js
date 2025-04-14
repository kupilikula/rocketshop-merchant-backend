const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const requestingMerchantId = request.user.merchantId; // From JWT

        // Check if requesting merchant is associated with store
        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant) {
            return reply.status(403).send({ error: 'Access denied' });
        }

        // Only allow Admin or Manager to fetch merchants list
        if (!['Admin', 'Manager'].includes(requestingMerchant.merchantRole)) {
            return reply.status(403).send({ error: 'Only Admin or Manager can view store merchants' });
        }

        // Fetch merchants
        const merchants = await knex('merchantStores')
            .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
            .where('merchantStores.storeId', storeId)
            .select(
                'merchants.*',
                'merchantStores.merchantRole',
                'merchantStores.canReceiveMessages'
            );

        return reply.send({ merchants });
    });
};