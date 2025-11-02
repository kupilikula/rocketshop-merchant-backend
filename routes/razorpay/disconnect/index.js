// in a new file, e.g., src/routes/razorpay/unlinkStore.js
'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {

    // The endpoint path matches the frontend's unlinkStore mutation call
    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const { storeId } = request.body;
        const { merchantId } = request.user;

        if (!storeId) {
            return reply.status(400).send({ error: 'A storeId is required.' });
        }

        logger.info({ merchantId, storeId }, "Attempting to unlink Razorpay for store.");

        const trx = await knex.transaction();
        try {
            // 1. Find the link record to get the associated credential ID.
            const linkRecord = await trx('store_razorpay_links')
                .where({ storeId })
                .first('razorpayCredentialId');

            // If the store is not linked, the desired state is already achieved.
            // We can return success immediately.
            if (!linkRecord) {
                await trx.rollback(); // No changes needed, rollback transaction.
                logger.info({ storeId }, "Store was not linked. No action taken.");
                return reply.send({ success: true, message: 'Store was not linked.' });
            }

            // 2. Find the owner of the credential that is linked to the store.
            const credentialOwner = await trx('razorpay_credentials')
                .where({ credentialId: linkRecord.razorpayCredentialId })
                .first('addedByMerchantId');

            // 3. **ENHANCED SECURITY CHECK**: Verify the current user is the credential owner.
            // This prevents a co-owner of a store from unlinking an account they didn't set up.
            if (!credentialOwner || credentialOwner.addedByMerchantId !== merchantId) {
                await trx.rollback();
                logger.warn({ merchantId, storeId }, "Forbidden attempt to unlink account by non-linking owner.");
                return reply.status(403).send({ error: 'Forbidden: Only the merchant who linked the account can unlink it.' });
            }

            // 4. If authorization passes, delete the link.
            await trx('store_razorpay_links')
                .where('storeId', storeId)
                .del();

            await trx.commit();

            logger.info({ storeId, merchantId }, "Successfully unlinked store by deleting its link.");
            return reply.send({ success: true, message: 'Razorpay account has been unlinked from this store.' });

        } catch (error) {
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            logger.error({ err: error, storeId, merchantId }, "Error unlinking Razorpay account.");
            return reply.status(500).send({ error: 'An internal server error occurred.' });
        }
    });
};