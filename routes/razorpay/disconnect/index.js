// Example: routes/stores/razorpayConnection.js

'use strict';

const knex = require('@database/knexInstance'); // Adjust path to your Knex instance

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const { storeId } = request.body;
        const merchantId = request.user.merchantId; // From authentication

        if (!storeId) {
            // Should be caught by schema validation if used, but good to have
            return reply.status(400).send({ error: 'storeId path parameter is required.' });
        }

        logger.info({ merchantId, storeId }, "Attempting to disconnect Razorpay account for store.");

        const trx = await knex.transaction();
        try {
            // 1. Verify merchant ownership/permission for the store
            //    (Assuming 'merchantStores' table links merchants to their stores)
            const merchantStoreAccess = await trx('merchantStores')
                .where({ storeId: storeId, merchantId: merchantId })
                // You might also check for a specific role, e.g., .andWhere('merchantRole', 'Admin')
                .first('merchantStoreId');

            if (!merchantStoreAccess) {
                await trx.rollback();
                logger.warn({ merchantId, storeId }, "Merchant lacks permission for this store or store does not exist for merchant.");
                return reply.status(403).send({ error: 'Forbidden: You do not have permission to manage this store\'s Razorpay connection.' });
            }
            logger.info({ merchantId, storeId }, "Merchant permission verified.");

            // 2. Find the store_razorpay_links record to get razorpayCredentialId
            const storeLink = await trx('store_razorpay_links')
                .where('storeId', storeId)
                .first('linkId', 'razorpayCredentialId');

            if (!storeLink) {
                await trx.rollback(); // Commit if you want to consider "already disconnected" as success
                logger.info({ storeId }, "No active Razorpay link found for this store. It might already be disconnected or was never connected.");
                return reply.status(200).send({ message: 'Razorpay account is not currently connected to this store.' });
            }

            const { linkId, razorpayCredentialId } = storeLink;
            logger.info({ storeId, linkId, razorpayCredentialId }, "Found Razorpay link. Proceeding with disconnection.");

            // 3. Delete the specific link from store_razorpay_links
            const deletedLinkCount = await trx('store_razorpay_links')
                .where('linkId', linkId) // Using primary key for precise deletion
                .del();

            if (deletedLinkCount === 0) {
                // This case should ideally not be hit if storeLink was found
                await trx.rollback();
                logger.error({ storeId, linkId }, "Failed to delete the store_razorpay_links record which was just found.");
                return reply.status(500).send({ error: 'An internal error occurred while trying to remove the store link.' });
            }
            logger.info({ storeId, linkId }, "Successfully deleted link from store_razorpay_links.");

            // 4. Check if any other store_razorpay_links point to the same razorpayCredentialId
            const otherLinksUsingCredential = await trx('store_razorpay_links')
                .where('razorpayCredentialId', razorpayCredentialId)
                .count('* as count')
                .first(); // Knex count returns an object like { count: 'N' }

            const remainingLinksCount = parseInt(otherLinksUsingCredential.count, 10);
            logger.info({ razorpayCredentialId, remainingLinksCount }, "Checked for other stores using the same Razorpay credential.");

            // 5. If no other links exist, delete the credential from razorpay_credentials
            if (remainingLinksCount === 0) {
                logger.info({ razorpayCredentialId }, "This Razorpay credential is no longer linked to any store. Deleting credential record.");
                const deletedCredentialsCount = await trx('razorpay_credentials')
                    .where('credentialId', razorpayCredentialId)
                    .del();
                logger.info({ razorpayCredentialId, deletedCredentialsCount }, "Deleted record from razorpay_credentials.");
                // Note: The ON DELETE CASCADE on store_razorpay_links.razorpayCredentialId would also
                // trigger if we deleted from razorpay_credentials first, but explicit deletion of the link
                // followed by conditional deletion of credentials is clear.
            } else {
                logger.info({ razorpayCredentialId, remainingLinksCount }, "Razorpay credential still linked to other stores. Not deleting credential record.");
            }

            await trx.commit();
            logger.info({ storeId, merchantId }, "Razorpay account successfully disconnected for the store.");
            return reply.status(200).send({ message: 'Razorpay account disconnected successfully.' });

        } catch (error) {
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            logger.error({ err: error, storeId, merchantId }, "Error during Razorpay account disconnection process.");
            return reply.status(500).send({ error: 'An internal server error occurred while disconnecting the Razorpay account.' });
        }
    });
};