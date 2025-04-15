'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {
        const { storeId, merchantId } = request.params;
        const { canReceiveMessages } = request.body;
        const requestingMerchantId = request.user.merchantId;

        if (typeof canReceiveMessages !== 'boolean') {
            return reply.status(400).send({ error: 'Invalid canReceiveMessages value' });
        }

        if (merchantId === requestingMerchantId) {
            return reply.status(400).send({ error: 'Cannot update your own messaging preference' });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || (requestingMerchant.merchantRole !== 'Admin' && requestingMerchant.merchantRole !== 'Manager')) {
            return reply.status(403).send({ error: 'Only Admin or Manager can update' });
        }

        const targetMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!targetMerchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        // Managers can only update Staff
        if (requestingMerchant.merchantRole === 'Manager' && targetMerchant.merchantRole !== 'Staff') {
            return reply.status(403).send({ error: 'Managers can only update Staff merchants' });
        }

        await knex('merchantStores')
            .where({ storeId, merchantId })
            .update({
                canReceiveMessages,
                updated_at: knex.fn.now(),
            });

        return reply.send({ success: true });
    });
}