'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');
const TokenService = require('../../../services/TokenService');
const { OTP_EXPIRY_MINUTES } = require("../../../utils/constants");
const {isValidEmail, isValidE164Phone} = require("../../../utils/validateIdentifier"); // Ensure this path is correct

module.exports = async function (fastify, opts) {
    fastify.post('/', {
        config: {
            rateLimit: {
                max: 10, // Max 10 registration attempts per IP
                timeWindow: '10m',
            }
        },
    }, async function (request, reply) {
        const { identifier, type, otp, fullName } = request.body;

        // 1. Input Validation
        if (!identifier || !type || !otp || !fullName) { // Schema should catch this, but defensive check.
            return reply.status(400).send({ message: 'Missing required fields: identifier, type, otp, fullName, app.' });
        }
        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ message: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ message: 'Invalid phone number format. Expected E.164 (e.g., +919876543210).' });
        }
        if (!fullName.trim()) {
            return reply.status(400).send({ message: 'Full name cannot be empty.' });
        }


        // 2. Check if merchant already exists (Primary defense against duplicate registration)
        let existingMerchantQuery = knex('merchants');
        if (type === 'phone') {
            existingMerchantQuery = existingMerchantQuery.where({ phone: identifier });
        } else { // type === 'email'
            existingMerchantQuery = existingMerchantQuery.where({ email: identifier });
        }
        const existingMerchant = await existingMerchantQuery.first();

        if (existingMerchant) {
            // This should ideally be caught by the isRegistered flag from /sendOtp,
            // but this is a final safeguard.
            fastify.log.warn({ msg: 'Registration attempt for already existing merchant.', identifier, type });
            return reply.status(409).send({ message: 'Merchant already registered with this ' + type + '.' }); // 409 Conflict
        }

        // 3. Verify OTP (Security measure: ensure the OTP was indeed verified for this session)
        let otpQuery = knex('otp_verification')
            .where({
                context: 'AUTH_LOGIN', // Registration flow uses OTP from AUTH_LOGIN context
                app: 'merchant',              // Use app from request
                identifier_type: type,
                otp: otp,              // Match the OTP itself
                isVerified: true       // Crucially, check that it was marked 'isVerified' by /verifyOtp
            })
            .orderBy('created_at', 'desc');

        if (type === 'phone') {
            otpQuery = otpQuery.andWhere({ phone: identifier });
        } else { // type === 'email'
            otpQuery = otpQuery.andWhere({ email: identifier });
        }
        const latestOtpRow = await otpQuery.first();

        if (!latestOtpRow) {
            fastify.log.warn({ msg: 'Merchant registration attempt with invalid/unverified OTP session.', identifier, type, context: 'AUTH_LOGIN' });
            return reply.status(401).send({ message: 'Invalid or unverified OTP session for registration. Please verify OTP again.' });
        }

        // Optional: Re-check OTP expiration
        const createdAt = new Date(latestOtpRow.created_at);
        const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60000);
        if (expiresAt < new Date()) {
            return reply.status(400).send({ message: 'OTP session has expired since verification. Please restart the registration process.' });
        }

        // 4. Create New Merchant
        const merchantId = uuidv4(); // Application-generated UUID
        const newMerchantData = {
            merchantId,
            fullName: fullName.trim(),
            phone: type === 'phone' ? identifier : null,
            email: type === 'email' ? identifier : null,
            // isPlatformMerchant: false, // Assuming default by DB schema or handle explicitly if needed
            // created_at and updated_at will be handled by table.timestamps(true, true)
        };

        try {
            const [merchant] = await knex('merchants')
                .insert(newMerchantData)
                .returning('*'); // Get the created merchant object

            if (!merchant) {
                // This should ideally not happen if insert doesn't throw and returning '*' is supported.
                fastify.log.error({ msg: 'Merchant insertion seemed to succeed but no merchant object returned.', newMerchantData });
                return reply.status(500).send({ message: 'Failed to create merchant account.' });
            }

            fastify.log.info({ msg: 'New merchant registered successfully.', merchantId: merchant.merchantId, identifier, type });

            // Optional: Clean up the used OTP record(s) for this registration session.
            // await knex('otp_verification').where({ otpId: latestOtpRow.otpId }).del();

            // 5. Generate tokens (New merchant will have no stores initially)
            // The frontend expects `stores` in the payload from onAuthSuccess.
            // For a new merchant, this will be an empty array.
            await TokenService.replyWithAuthTokens(reply, merchant, []); // Pass empty array for stores

        } catch (dbError) {
            fastify.log.error({ msg: 'Database error during merchant registration.', error: dbError, newMerchantData });
            if (dbError.routine && (dbError.routine.includes('_bt_check_unique') || dbError.routine.includes('unique_violation'))) {
                // This could be a race condition if the initial check passed but another request registered the identifier.
                return reply.status(409).send({ message: `This ${type} is already registered. Please try logging in.` });
            }
            return reply.status(500).send({ message: 'Failed to create merchant account due to a server error.' });
        }
    });
}