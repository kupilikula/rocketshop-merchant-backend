const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const { newMerchantRole } = request.body;
        const requestingMerchantId = request.user.merchantId; // From JWT

        if (!newMerchantRole || !['Admin', 'Manager', 'Staff'].includes(newMerchantRole)) {
            return reply.status(400).send({ error: 'Invalid role' });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant) {
            return reply.status(403).send({ error: 'Unauthorized' });
        }

        if (merchantId === requestingMerchantId) {
            return reply.status(400).send({ error: 'Cannot change your own role.' });
        }

        const targetMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!targetMerchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        // Authorization Logic
        if (requestingMerchant.merchantRole === 'Admin') {
            // Admin can change any role (checks for demoting only Admin below)
        } else if (requestingMerchant.merchantRole === 'Manager') {
            // Manager can only promote Staff to Manager
            if (targetMerchant.merchantRole !== 'Staff' || newMerchantRole !== 'Manager') {
                return reply.status(403).send({ error: 'Managers can only promote Staff to Manager' });
            }
        } else {
            return reply.status(403).send({ error: 'Only Admin or Manager can update roles' });
        }

        // Prevent demoting the only Admin
        if (targetMerchant.merchantRole === 'Admin' && newMerchantRole !== 'Admin') {
            const adminCount = await knex('merchantStores')
                .where({ storeId, merchantRole: 'Admin' })
                .count('merchantStoreId as count')
                .first();

            if (adminCount.count <= 1) {
                return reply.status(400).send({ error: 'Cannot demote the only Admin in the store.' });
            }
        }

        await knex('merchantStores')
            .where({ storeId, merchantId })
            .update({
                merchantRole: newMerchantRole,
                updated_at: knex.fn.now(),
            });

        return reply.status(200).send({ success: true });
    });
};