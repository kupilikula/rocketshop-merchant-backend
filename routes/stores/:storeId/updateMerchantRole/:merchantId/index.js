const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId, merchantId } = request.params;
        const { role } = request.body;
        const requestingMerchantId = request.user.merchantId; // From JWT

        if (!role || !['Admin', 'Manager', 'Staff'].includes(role)) {
            return reply.status(400).send({ error: 'Invalid role' });
        }

        // Check if requesting merchant is Admin in this store
        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || requestingMerchant.role !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can update roles.' });
        }

        // Prevent changing own role (optional but recommended)
        if (merchantId === requestingMerchantId) {
            return reply.status(400).send({ error: 'Cannot change your own role.' });
        }

        // Check if target merchant exists
        const targetMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!targetMerchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        // If target is Admin and this change demotes them,
        // Check if they are the only Admin
        if (targetMerchant.role === 'Admin' && role !== 'Admin') {
            const adminCount = await knex('merchantStores')
                .where({ storeId, role: 'Admin' })
                .count('merchantStoreId as count')
                .first();

            if (adminCount.count <= 1) {
                return reply.status(400).send({ error: 'Cannot demote the only Admin in the store.' });
            }
        }

        // Proceed with role update
        await knex('merchantStores')
            .where({ storeId, merchantId })
            .update({
                role,
                updated_at: knex.fn.now(),
            });

        return reply.status(200).send({ success: true });
    });
};