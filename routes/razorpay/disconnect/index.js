'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {

    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        // It's slightly more conventional for a specific resource action to use params, but body is fine.
        const { storeId } = request.body;
        const { merchantId } = request.user;

        if (!storeId) {
            return reply.status(400).send({ error: 'A storeId is required.' });
        }

        logger.info({ merchantId, storeId }, "Attempting to disconnect Razorpay link for store.");

        const trx = await knex.transaction();
        try {
            // --- 1. UPDATED: Verify merchant is the 'Owner' of this store ---
            const storeAccess = await trx('merchantStores')
                .where({
                    storeId: storeId,
                    merchantId: merchantId,
                    merchantRole: 'Owner' // <-- The added security check
                })
                .first('merchantStoreId');

            if (!storeAccess) {
                logger.warn({ merchantId, storeId }, "Forbidden attempt to disconnect store by non-owner.");
                await trx.rollback();
                return reply.status(403).send({ error: 'Forbidden: Only the store owner can manage payment settings.' });
            }

            // --- 2. Your core logic is already correct ---
            // Delete the link from store_razorpay_links. This disconnects the store
            // while preserving the merchant's main credential record.
            const deletedLinkCount = await trx('store_razorpay_links')
                .where('storeId', storeId)
                .del();

            await trx.commit();

            if (deletedLinkCount > 0) {
                logger.info({ storeId }, "Successfully disconnected store by deleting its link.");
            } else {
                logger.info({ storeId }, "Store was not connected. No action taken.");
            }

            return reply.status(200).send({ success: true, message: 'Razorpay account has been disconnected from this store.' });

        } catch (error) {
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            logger.error({ err: error, storeId, merchantId }, "Error disconnecting Razorpay account.");
            return reply.status(500).send({ error: 'An internal server error occurred.' });
        }
    });
};