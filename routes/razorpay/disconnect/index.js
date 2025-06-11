'use strict';

const knex = require('@database/knexInstance'); // Adjust path

module.exports = async function (fastify, opts) {

    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const { storeId } = request.body;
        const merchantId = request.user.merchantId;

        if (!storeId) {
            return reply.status(400).send({ error: 'A storeId is required.' });
        }

        logger.info({ merchantId, storeId }, "Attempting to disconnect Razorpay link for store.");

        try {
            // 1. Verify merchant has permission to manage this store
            const storeAccess = await knex('merchantStores')
                .where({ storeId: storeId, merchantId: merchantId })
                .first('merchantStoreId');

            if (!storeAccess) {
                logger.warn({ merchantId, storeId }, "Forbidden attempt to disconnect store.");
                return reply.status(403).send({ error: 'Forbidden: You do not have permission to manage this store.' });
            }

            // 2. Delete the link from store_razorpay_links.
            //    This is the only action needed for a "disconnect". We preserve the core credential.
            const deletedLinkCount = await knex('store_razorpay_links')
                .where('storeId', storeId)
                .del();

            if (deletedLinkCount > 0) {
                logger.info({ storeId }, "Successfully disconnected store by deleting its link.");
                // Invalidate frontend cache for this store's status
                // (The frontend will call useGetRazorpayStatus again and see isConnected: false)
            } else {
                logger.info({ storeId }, "Store was not connected. No action taken.");
            }

            return reply.status(200).send({ success: true, message: 'Razorpay account has been disconnected from this store.' });

        } catch (error) {
            logger.error({ err: error, storeId, merchantId }, "Error disconnecting Razorpay account.");
            return reply.status(500).send({ error: 'An internal server error occurred.' });
        }
    });
};