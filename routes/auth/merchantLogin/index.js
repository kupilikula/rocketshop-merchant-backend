'use strict'

const knex = require("@database/knexInstance");
const TokenService = require('../../../services/TokenService');
const { OTP_EXPIRY_MINUTES } = require("../../../utils/constants");
const {isValidEmail, isValidE164Phone} = require("../../../utils/validateIdentifier"); // Ensure this path is correct

module.exports = async function (fastify, opts) {
    // Assuming this route is effectively /auth/merchantLogin
    fastify.post('/', {
        config: {
            rateLimit: {
                max: 10, // Max 10 login attempts per IP
                timeWindow: '10m',
            }
        },
    }, async function (request, reply) {
        const { identifier, type, otp, app } = request.body;

        // 1. Input Validation
        if (!identifier || !type || !otp) { // Partially covered by schema, but explicit check is good.
            return reply.status(400).send({ message: 'Identifier, type, and OTP are required.' });
        }
        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ message: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ message: 'Invalid phone number format. Expected E.164 (e.g., +919876543210).' });
        }

        // 2. Re-verify OTP (Security measure: ensure the OTP was indeed verified for this session)
        let otpQuery = knex('otp_verification')
            .where({
                context: 'AUTH_LOGIN', // Login flow uses AUTH_LOGIN context
                app: 'merchant', // Use app from request or default to 'merchant'
                identifier_type: type,
                otp: otp, // Match the OTP itself
                isVerified: true // Crucially, check that it was marked as verified by /verifyOtp
            })
            .orderBy('created_at', 'desc');

        if (type === 'phone') {
            otpQuery = otpQuery.andWhere({ phone: identifier });
        } else { // type === 'email'
            otpQuery = otpQuery.andWhere({ email: identifier });
        }
        const latestOtpRow = await otpQuery.first();

        if (!latestOtpRow) {
            // This means either OTP didn't match, wasn't for this identifier/type/context,
            // or wasn't marked as 'isVerified' by the /verifyOtp step.
            fastify.log.warn({ msg: 'Merchant login attempt with invalid/unverified OTP session.', identifier, type, context: 'AUTH_LOGIN', app });
            return reply.status(401).send({ message: 'Invalid or unverified OTP session. Please try verifying OTP again.' });
        }

        // Optional: Re-check OTP expiration again for an additional layer of safety
        const createdAt = new Date(latestOtpRow.created_at);
        const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60000);
        if (expiresAt < new Date()) {
            // This OTP was verified but has since expired before login completion.
            return reply.status(400).send({ message: 'OTP session has expired. Please restart the login process.' });
        }

        // 3. Find Merchant
        let merchantQuery = knex('merchants');
        if (type === 'phone') {
            merchantQuery = merchantQuery.where({ phone: identifier });
        } else { // type === 'email'
            merchantQuery = merchantQuery.where({ email: identifier });
        }
        const merchant = await merchantQuery.first();

        if (!merchant) {
            // This should ideally not happen if the isRegisteredUser flag from /sendOtp was true
            // and the identifier hasn't been changed/deleted since.
            fastify.log.error({ msg: 'Merchant not found during login despite OTP verification indicating registered user.', identifier, type });
            return reply.status(404).send({ message: 'Merchant account not found. Please ensure you are registered.' });
        }

        fastify.log.info({ msg: 'Merchant login successful (pre-token)', merchantId: merchant.merchantId, identifier, type });

        // 4. Get associated stores
        let stores = [];
        try {
            stores = await knex('stores')
                .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
                .where('merchantStores.merchantId', merchant.merchantId)
                .select('stores.*');
        } catch (dbError) {
            fastify.log.error({ msg: 'Failed to fetch stores for merchant during login', error: dbError, merchantId: merchant.merchantId });
            // Decide if login should fail or proceed without stores.
            // For now, proceed, token service might handle empty stores.
        }

        // Optional: Clean up OTPs for this login session.
        // It's good practice to ensure a verified OTP used for login cannot be replayed for another login.
        // The `isVerified:true` check above already helps, but deleting or further invalidating adds safety.
        // await knex('otp_verification').where({ otpId: latestOtpRow.otpId }).del(); // Delete specific OTP
        // Or more broadly for the session:
        await knex('otp_verification').where({
            [type === 'phone' ? 'phone' : 'email']: identifier,
            identifier_type: type,
            app: 'merchant',
            context: 'AUTH_LOGIN',
            isVerified: true // Clean up verified login OTPs
        }).del();


        // 5. Generate tokens & send response
        try {
            // Assuming TokenService.replyWithAuthTokens expects (reply, userObject, additionalPayload)
            // Your current code passes 'stores' directly as the third argument.
            // If TokenService expects an object for additional payload, it would be:
            // await TokenService.replyWithAuthTokens(reply, merchant, { stores });
            // Sticking to your existing pattern:
            await TokenService.replyWithAuthTokens(reply, merchant, stores);
        } catch (tokenError) {
            fastify.log.error({ msg: 'Token generation failed during merchant login', error: tokenError, merchantId: merchant.merchantId });
            return reply.status(500).send({ message: 'Login failed due to an issue generating authentication tokens.' });
        }
    });
}