'use strict';

const knex = require("@database/knexInstance");
// --- NEW: Make sure you import your validation helpers ---
const { isValidEmail, isValidE164Phone } = require("../../../../utils/validateIdentifier");
const {checkStoreActivationReadiness} = require("../../../../utils/checkStoreActivationReadiness");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {

        const { storeId } = request.params;
        const { merchantId } = request.user; // Get merchantId from the authenticated user
        const { identifier, type, otp } = request.body;

        // --- 1. UPDATED: Input Validation (from your login endpoint) ---
        if (!identifier || !type || !otp) {
            return reply.status(400).send({ error: 'Identifier, type, and OTP are required.' });
        }
        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ error: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ error: 'Invalid phone number format. Expected E.164.' });
        }

        // --- 2. UPDATED: Robust OTP Verification (from your login endpoint) ---
        let otpQuery = knex('otp_verification')
            .where({
                context: 'ACTIVATE_STORE', // This context is specific to activating a store
                app: 'merchant',
                otp: otp,
                isVerified: true // Crucially, ensure it was pre-verified by your /verifyOtp endpoint
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
            fastify.log.warn({ msg: 'Activate store attempt with invalid/unverified OTP.', identifier, storeId });
            return reply.status(401).send({ error: 'Invalid or unverified OTP session. Please verify the OTP again.' });
        }
        // Optional: Add expiration check here if desired


        // --- 3. Permission & Store State Checks (Unchanged) ---
        const merchant = await knex('merchantStores').where({ storeId, merchantId }).first();
        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can activate the store.' });
        }

        const store = await knex('stores').where({ storeId }).first();
        if (!store) { return reply.status(404).send({ error: 'Store not found.' }); }
        if (store.isActive) { return reply.send({ success: true, message: 'Store is already active.' }); }

        const readinessStatus = await checkStoreActivationReadiness({ store });

        if (readinessStatus.isReady) {
            // --- Success Path ---
            await knex('stores')
                .where({ storeId })
                .update({ isActive: true, updated_at: knex.fn.now() });

            // --- NEW: Clean up the used OTP for security ---
            await knex('otp_verification').where({ otpId: latestOtp.otpId }).del();

            // Clean up the used OTP
            // const latestOtp = ... (You'll need to have fetched this above)
            // await knex('otp_verification').where({ otpId: latestOtp.otpId }).del();

            return reply.send({ success: true, message: 'Store successfully activated.' });

        } else {
            // --- Failure Path ---
            // The readiness check failed. Return the specific reason.
            fastify.log.warn(`Activation failed for ${storeId}: ${readinessStatus.message}`);

            // If the failure was due to subscription, send the 402 error and link
            if (!readinessStatus.checks.hasActiveSubscription && !readinessStatus.checks.isPlatformOwned) {
                const subdomain = process.env.NODE_ENV === 'production' ? 'subscription' : 'subscription.qa';
                const webBillingUrl = `https://${subdomain}.rocketshop.in/billing?storeId=${storeId}`;
                return reply.status(402).send({
                    success: false,
                    error: 'Payment Required',
                    message: readinessStatus.message,
                    manageSubscriptionUrl: webBillingUrl
                });
            }

            // For any other readiness failure (e.g., no active products)
            return reply.status(400).send({
                success: false,
                error: 'INCOMPLETE_SETUP',
                message: readinessStatus.message
            });
        }

    });
};