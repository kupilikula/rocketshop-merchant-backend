'use strict';

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');
// const { sendOtp } = require("@services/otpService"); // Existing SMS provider code
const { generateOtp } = require("../../../../utils/generateOtp");  // A function that returns 6-digit random OTP

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeId } = request.params;
        const { actionType } = request.body; // 'DEACTIVATE' or 'DELETE'
        const requestingMerchantId = request.user.merchantId;

        if (!['DEACTIVATE', 'DELETE'].includes(actionType)) {
            return reply.status(400).send({ error: 'Invalid action type' });
        }

        // Verify requesting merchant is Admin
        const merchant = await knex('merchantStores')
            .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
            .where('merchantStores.storeId', storeId)
            .andWhere('merchantStores.merchantId', requestingMerchantId)
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can perform this action.' });
        }

        const otp = generateOtp(); // Generate 6-digit OTP e.g. 123456

        // Insert into otp_verification table
        await knex('otp_verification').insert({
            otpId: uuidv4(),
            phone: merchant.phone,
            otp,
            app: 'merchant',
            isVerified: false,
            created_at: knex.fn.now(),
        });

        // Send the OTP via SMS
        console.log(`Sending OTP ${otp} to ${merchant.phone}`);
        // await sendOtp(merchant.phone, 'merchant', otp);

        return reply.send({ success: true });
    });
};