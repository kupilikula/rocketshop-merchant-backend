const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.delete('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const requestingMerchantId = request.user.merchantId; // From JWT payload

        // Verify that requesting merchant belongs to this store and is Admin
        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || requestingMerchant.role !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can remove merchants from store.' });
        }

        // Check total merchants in this store
        const totalMerchants = await knex('merchantStores')
            .where({ storeId })
            .count('merchantStoreId as count')
            .first();

        if (totalMerchants.count <= 1) {
            return reply.status(400).send({ error: 'Cannot remove the only merchant from the store.' });
        }

        // Check if the merchant being removed is the only Admin
        const adminMerchants = await knex('merchantStores')
            .where({ storeId, role: 'Admin' });

        if (adminMerchants.length === 1 && adminMerchants[0].merchantId === merchantId) {
            return reply.status(400).send({ error: 'Cannot remove the only Admin from the store.' });
        }

        // Proceed with deletion
        await knex('merchantStores')
            .where({ storeId, merchantId })
            .del();

        return reply.status(200).send({ success: true });
    });
};