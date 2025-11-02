'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
<<<<<<< Updated upstream:routes/stores/:storeId/linkPaymentAccount/index.js
        const { storeId } = request.params;
=======
        // 1. Explicitly get storeId and credentialId from the request body
        const { storeId, credentialId } = request.body;
>>>>>>> Stashed changes:routes/razorpay/link-payment-account/index.js
        const { merchantId } = request.user;
        const logger = fastify.log;

        const trx = await knex.transaction();
        try {
            // 1. Verify the user is the 'Owner' of this store.
            const storeAccess = await trx('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first();

            if (!storeAccess) {
                await trx.rollback();
                return reply.status(403).send({ error: 'Forbidden: Only the store owner can link a payment account.' });
            }

            // 2. Find the merchant's existing, fully onboarded credential record.
            const credential = await trx('razorpay_credentials')
                .where({ addedByMerchantId: merchantId })
                .first();

            if (!credential || !credential.razorpayLinkedAccountId) {
                await trx.rollback();
                // This case should not be hit if the frontend logic is correct, but it's a good safeguard.
                return reply.status(404).send({ error: 'Merchant payment profile not found or setup is incomplete.' });
            }

            // 3. Check if this store is already linked to prevent duplicates.
            const existingLink = await trx('store_razorpay_links').where({ storeId }).first();
            if(existingLink) {
                await trx.rollback();
                return reply.status(409).send({ error: 'This store is already linked to a payment account.' });
            }

            // 4. Create the link.
            await trx('store_razorpay_links').insert({
                storeId: storeId,
                razorpayCredentialId: credential.credentialId
            });

            await trx.commit();
            logger.info({ storeId, merchantId, credentialId: credential.credentialId }, "Successfully linked store to existing payment profile.");

            return reply.send({ success: true, message: 'Store linked to payment account successfully.' });

        } catch (error) {
            if (trx && !trx.isCompleted()) await trx.rollback();
            logger.error({ err: error, storeId, merchantId }, 'Error during store payment account linking.');
            return reply.status(500).send({ error: 'An unexpected server error occurred.' });
        }
    });
};