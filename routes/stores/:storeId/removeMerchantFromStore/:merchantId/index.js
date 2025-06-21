const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.delete('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const requestingMerchantId = request.user.merchantId; // From JWT payload

        if (merchantId === requestingMerchantId) {
            return reply.status(400).send({ error: 'You cannot remove yourself from the store.' });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant) {
            return reply.status(403).send({ error: 'Access denied.' });
        }

        const targetMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!targetMerchant) {
            return reply.status(404).send({ error: 'Merchant not found in this store.' });
        }

        // Role-based checks
        if (requestingMerchant.merchantRole === 'Admin' && ['Owner', 'Admin'].includes(targetMerchant.merchantRole)) {
            return reply.status(403).send({ error: 'Admins can only remove Manager/Staff merchants.' });
        }

        if (requestingMerchant.merchantRole === 'Manager' && targetMerchant.merchantRole !== 'Staff') {
            return reply.status(403).send({ error: 'Managers can only remove Staff merchants.' });
        }

        if (!['Owner', 'Admin', 'Manager'].includes(requestingMerchant.merchantRole)) {
            return reply.status(403).send({ error: 'Only Owner, Admin or Manager can remove merchants.' });
        }

        // Total merchants in store
        const totalMerchants = await knex('merchantStores')
            .where({ storeId })
            .count('merchantStoreId as count')
            .first();

        if (totalMerchants.count <= 1) {
            return reply.status(400).send({ error: 'Cannot remove the only merchant from the store.' });
        }

        // Prevent removing the only Owner
        if (targetMerchant.merchantRole === 'Owner') {
            const ownerCount = await knex('merchantStores')
                .where({ storeId, merchantRole: 'Owner' })
                .count('merchantStoreId as count')
                .first();

            if (ownerCount.count <= 1) {
                return reply.status(400).send({ error: 'Cannot remove the only Owner from the store.' });
            }
        }

        await knex('merchantStores')
            .where({ storeId, merchantId })
            .del();

        return reply.status(200).send({ success: true });
    });
};