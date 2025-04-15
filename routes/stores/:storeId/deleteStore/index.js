'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeId } = request.params;
        const { confirmationText, phone, otp } = request.body;
        const requestingMerchantId = request.user.merchantId;


        const latestOtp = await knex('otp_verification')
            .where({ phone, app: 'merchant' })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtp || latestOtp.otp !== otp || !latestOtp.isVerified) {
            return reply.status(401).send({ error: 'Invalid or expired OTP' });
        }

        // Check if requesting merchant is Admin
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can delete the store.' });
        }

        const store = await knex('stores')
            .where({ storeId })
            .first();

        if (!store) {
            return reply.status(404).send({ error: 'Store not found' });
        }

        if (store.isActive) {
            return reply.status(400).send({ error: 'Store is active. Please deactivate the store first.' });
        }

        const expectedText = `Delete ${store.storeName}`;

        if (confirmationText !== expectedText) {
            return reply.status(400).send({ error: `Confirmation text mismatch. Please type exactly: ${expectedText}` });
        }

        // Proceed to delete the store
        await knex('stores')
            .where({ storeId })
            .del();

        return reply.send({ success: true });
    });
};