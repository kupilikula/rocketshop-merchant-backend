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

        if (!requestingMerchant || (!['Owner', 'Admin', 'Manager'].includes(requestingMerchant.merchantRole))) {
            return reply.status(403).send({ error: 'Only Owner, Admin or Manager can update' });
        }

        const targetMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!targetMerchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }
        // Admins can only update Managers and Staff
        if (requestingMerchant.merchantRole === 'Admin' && !['Manager', 'Staff'].includes(targetMerchant.merchantRole)) {
            return reply.status(403).send({ error: 'Admins can only update Manager/Staff merchants' });
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