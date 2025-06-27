'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {

        const { storeId } = request.params;
        const { merchantId } = request.user;
        const logger = fastify.log;

        // 1. Initial Validation
        if (!merchantId) {
            return reply.status(401).send({ error: 'Authentication failed: Merchant ID missing.' });
        }
        if (!storeId) {
            return reply.status(400).send({ error: 'A storeId query parameter is required.' });
        }

        try {
            // 2. Authorization Check: Verify the current user is an 'Owner' of the store they are querying.
            const storeAccess = await knex('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first('merchantStoreId');

            if (!storeAccess) {
                return reply.status(403).send({ error: 'Forbidden: Only the store owner can manage payment settings.' });
            }

            // 3. The "Store-First" Check: See if the store is already linked to ANY credential set.
            const linkRecord = await knex('store_razorpay_links as srl')
                .join('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .join('merchants as m', 'rc.addedByMerchantId', 'm.merchantId')
                .where('srl.storeId', storeId)
                .select(
                    'rc.addedByMerchantId',
                    'rc.razorpayAccountId',
                    'm.fullName as linkedMerchantName'
                )
                .first();

            // 4. Handle Case A: The store IS already linked to a payment profile.
            if (linkRecord) {
                const isLinkedToCurrentUser = linkRecord.addedByMerchantId === merchantId;

                // Case A.1: Linked to the CURRENT user viewing the page.
                if (isLinkedToCurrentUser) {
                    logger.info({ merchantId, storeId }, "Store is linked to the current merchant. Fetching live details.");
                    return reply.send({
                        status: 'LINKED',
                        linkedAccountId: linkRecord.razorpayAccountId,
                        linkedOwnerName: linkRecord.linkedMerchantName
                    });
                }
                // Case A.2: Linked to a DIFFERENT owner.
                else {
                    logger.info({ merchantId, storeId }, "Store is linked, but by another merchant.");
                    return reply.send({
                        status: 'LINKED_BY_OTHER',
                        linkedOwnerName: linkRecord.linkedMerchantName
                    });
                }
            } else {                // Case B.2: Merchant has never been onboarded.
                logger.info({ merchantId }, 'Merchant has not been onboarded with Razorpay yet.');
                return reply.send({
                    status: 'NOT_LINKED',
                });
            }
        } catch (dbError) {
            logger.error({ err: dbError, storeId, merchantId }, 'Error during payment setup status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};