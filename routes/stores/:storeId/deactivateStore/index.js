'use strict';

const knex = require("@database/knexInstance");
// --- NEW: Make sure you import your validation helpers ---
const { isValidEmail, isValidE164Phone } = require("../../../../utils/validateIdentifier");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {

        const { storeId } = request.params;
        const { merchantId } = request.user; // Get merchantId from the authenticated user
        const { identifier, type, otp } = request.body;

        // --- 1. UPDATED: Input Validation ---
        if (!identifier || !type || !otp) {
            return reply.status(400).send({ error: 'Identifier, type, and OTP are required.' });
        }
        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ error: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ error: 'Invalid phone number format. Expected E.164.' });
        }

        // --- 2. UPDATED: Robust OTP Verification ---
        let otpQuery = knex('otp_verification')
            .where({
                context: 'DEACTIVATE_STORE', // This context is specific to deactivating a store
                app: 'merchant',
                otp: otp,
                isVerified: true // Ensure it was pre-verified by your /verifyOtp endpoint
            })
            .orderBy('created_at', 'desc');

        // Dynamically add the where clause for phone or email
        if (type === 'phone') {
            otpQuery = otpQuery.andWhere({ phone: identifier });
        } else { // type === 'email'
            otpQuery = otpQuery.andWhere({ email: identifier });
        }
        const latestOtp = await otpQuery.first();

        if (!latestOtp) {
            fastify.log.warn({ msg: 'Deactivate store attempt with invalid/unverified OTP.', identifier, storeId });
            return reply.status(401).send({ error: 'Invalid or unverified OTP session. Please verify the OTP again.' });
        }

        // --- 3. Permission Check (Unchanged) ---
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: merchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can deactivate the store.' });
        }

        // --- 4. Perform the Deactivation (Unchanged) ---
        await knex('stores')
            .where({ storeId })
            .update({
                isActive: false,
                updated_at: knex.fn.now(),
            });

        // --- 5. NEW: Clean up the used OTP for security ---
        await knex('otp_verification').where({ otpId: latestOtp.otpId }).del();

        return reply.send({ success: true, message: 'Store successfully deactivated.' });
    });
};