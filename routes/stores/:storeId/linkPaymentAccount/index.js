// in a new file, e.g., src/routes/razorpay/linkStore.js
'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        // 1. Explicitly get storeId and credentialId from the request body
        const { storeId } = request.params;
        const { credentialId } = request.body;
        const { merchantId } = request.user;
        const logger = fastify.log;

        if (!storeId || !credentialId) {
            return reply.status(400).send({ error: 'storeId and credentialId are required.' });
        }

        const trx = await knex.transaction();
        try {
            // 2. Authorization Step 1: Verify the user is an 'Owner' of the store.
            const storeAccess = await trx('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first('merchantStoreId');

            if (!storeAccess) {
                await trx.rollback();
                return reply.status(403).send({ error: 'Forbidden: You do not have permission for this store.' });
            }

            // 3. Authorization Step 2: Verify the user owns the credential they're trying to link.
            // This prevents a user from linking a store to someone else's credentials.
            const credentialAccess = await trx('razorpay_credentials')
                .where({ credentialId, addedByMerchantId: merchantId })
                .first('credentialId');

            if (!credentialAccess) {
                await trx.rollback();
                return reply.status(403).send({ error: 'Forbidden: You do not have access to these credentials.' });
            }

            // 4. Create or Update the link using a robust "upsert" operation.
            // This will link the store if it's not linked, or update the link if it was previously
            // linked to a different credential set.
            await trx('store_razorpay_links')
                .insert({
                    storeId: storeId,
                    razorpayCredentialId: credentialId
                })
                .onConflict('storeId') // The unique key
                .merge({ // What to do if the storeId already exists
                    razorpayCredentialId: credentialId,
                    updated_at: new Date()
                });

            await trx.commit();
            logger.info({ storeId, merchantId, credentialId }, "Successfully linked store to existing credential.");

            return reply.send({ success: true, message: 'Store linked successfully.' });

        } catch (error) {
            if (trx && !trx.isCompleted()) await trx.rollback();
            logger.error({ err: error, storeId, merchantId }, 'Error during store credential linking.');
            return reply.status(500).send({ error: 'An unexpected server error occurred.' });
        }
    });
};