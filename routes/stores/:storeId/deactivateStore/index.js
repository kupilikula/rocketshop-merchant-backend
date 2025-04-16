'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {
        const { storeId } = request.params;
        const requestingMerchantId = request.user.merchantId;
        const { phone, otp } = request.body;

        const latestOtp = await knex('otp_verification')
            .where({ phone, app: 'merchant', context: "DEACTIVATE_STORE" })
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
            return reply.status(403).send({ error: 'Only Admin merchants can deactivate the store.' });
        }

        await knex('stores')
            .where({ storeId })
            .update({
                isActive: false,
                updated_at: knex.fn.now(),
            });

        return reply.send({ success: true });
    });
};