const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const { role } = request.body;
        const requestingMerchantId = request.user.merchantId; // From JWT

        if (!role || !['Admin', 'Manager', 'Staff'].includes(role)) {
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
        if (requestingMerchant.role === 'Admin') {
            // Admin can change any role (checks for demoting only Admin below)
        } else if (requestingMerchant.role === 'Manager') {
            // Manager can only promote Staff to Manager
            if (targetMerchant.role !== 'Staff' || role !== 'Manager') {
                return reply.status(403).send({ error: 'Managers can only promote Staff to Manager' });
            }
        } else {
            return reply.status(403).send({ error: 'Only Admin or Manager can update roles' });
        }

        // Prevent demoting the only Admin
        if (targetMerchant.role === 'Admin' && role !== 'Admin') {
            const adminCount = await knex('merchantStores')
                .where({ storeId, role: 'Admin' })
                .count('merchantStoreId as count')
                .first();

            if (adminCount.count <= 1) {
                return reply.status(400).send({ error: 'Cannot demote the only Admin in the store.' });
            }
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