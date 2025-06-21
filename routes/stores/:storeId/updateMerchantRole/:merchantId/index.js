'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId, merchantId: targetMerchantId } = request.params;
        const { newMerchantRole } = request.body;
        const { merchantId: requestingMerchantId } = request.user;

        // --- 1. Initial Validation ---
        if (!newMerchantRole || !['Owner', 'Admin', 'Manager', 'Staff'].includes(newMerchantRole)) {
            return reply.status(400).send({ error: 'Invalid newMerchantRole provided.' });
        }

        if (targetMerchantId === requestingMerchantId) {
            return reply.status(400).send({ error: 'You cannot change your own role.' });
        }

        // --- 2. Fetch Records in a Single Transaction ---
        const trx = await knex.transaction();
        try {
            const [requestingMerchant, targetMerchant] = await Promise.all([
                trx('merchantStores').where({ storeId, merchantId: requestingMerchantId }).first(),
                trx('merchantStores').where({ storeId, merchantId: targetMerchantId }).first()
            ]);

            if (!requestingMerchant) {
                await trx.rollback();
                return reply.status(403).send({ error: 'You do not have permission to manage this store.' });
            }
            if (!targetMerchant) {
                await trx.rollback();
                return reply.status(404).send({ error: 'Target merchant not found in this store.' });
            }

            // --- 3. The Core Authorization Logic ---
            const roleHierarchy = { 'Staff': 1, 'Manager': 2, 'Admin': 3, 'Owner': 4 };
            const requesterLevel = roleHierarchy[requestingMerchant.merchantRole];
            const targetLevel = roleHierarchy[targetMerchant.merchantRole];

            let isAuthorized = false;

            switch (requestingMerchant.merchantRole) {
                case 'Owner':
                    // An Owner can change any role, but we prevent them from demoting another Owner.
                    if (targetMerchant.merchantRole === 'Owner' && newMerchantRole !== 'Owner') {
                        await trx.rollback();
                        return reply.status(403).send({ error: "An Owner cannot be demoted. They must be removed from the store." });
                    }
                    isAuthorized = true;
                    break;

                case 'Admin':
                    // An Admin cannot modify an Owner or another Admin.
                    if (targetLevel >= requesterLevel) {
                        await trx.rollback();
                        return reply.status(403).send({ error: "Admins cannot modify users with an equal or higher role." });
                    }
                    // An Admin cannot promote anyone to Owner.
                    if (newMerchantRole === 'Owner') {
                        await trx.rollback();
                        return reply.status(403).send({ error: "You do not have permission to assign the Owner role." });
                    }
                    isAuthorized = true;
                    break;

                case 'Manager':
                    // A Manager can ONLY promote Staff to Manager.
                    if (targetMerchant.merchantRole === 'Staff' && newMerchantRole === 'Manager') {
                        isAuthorized = true;
                    }
                    break;
            }

            if (!isAuthorized) {
                await trx.rollback();
                return reply.status(403).send({ error: 'Your role does not permit this action.' });
            }

            // --- 4. Special Business Logic Checks ---

            // Check for demoting the last Owner
            const isDemotingOwner = targetMerchant.merchantRole === 'Owner' && newMerchantRole !== 'Owner';
            if (isDemotingOwner) {
                const ownerCountResult = await trx('merchantStores')
                    .where({ storeId, merchantRole: 'Owner' })
                    .count('merchantStoreId as count')
                    .first();

                const ownerCount = parseInt(ownerCountResult.count, 10);
                if (ownerCount <= 1) {
                    await trx.rollback();
                    return reply.status(400).send({ error: 'Cannot demote the only Owner. Create a new owner first.' });
                }
            }


            // --- 5. Perform the Update ---
            await trx('merchantStores')
                .where({ merchantStoreId: targetMerchant.merchantStoreId })
                .update({
                    merchantRole: newMerchantRole,
                    updated_at: knex.fn.now(),
                });

            await trx.commit();
            return reply.send({ success: true, message: `Merchant role successfully updated to ${newMerchantRole}.` });

        } catch (error) {
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            fastify.log.error({ err: error }, "Error updating merchant role.");
            return reply.status(500).send({ error: "An internal server error occurred." });
        }
    });
};