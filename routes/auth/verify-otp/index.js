'use strict'

const knex = require("@database/knexInstance");
const { OTP_PUBLIC_CONTEXTS, OTP_PRIVATE_CONTEXTS } = require("../../utils/OtpContexts");
const { OTP_EXPIRY_MINUTES, MAX_OTP_ATTEMPTS } = require("../../utils/constants");
const {isValidEmail, isValidE164Phone} = require("../../utils/validateIdentifier"); // Assuming MAX_OTP_ATTEMPTS is defined, e.g., 5

module.exports = async function (fastify, opts) {
    fastify.post('/', {
        config: {
            rateLimit: {
                max: 10, // Max 10 verification attempts per IP
                timeWindow: '10m',
            }
        },
    }, async function (request, reply) {
        const { identifier, type, otp, context } = request.body;

        // 1. Input Validation (partially handled by schema)
        if (!identifier || !type || !otp || !context) {
            return reply.status(400).send({ message: 'Missing required fields.' });
        }

        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ message: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ message: 'Invalid phone number format. Expected E.164 (e.g., +919876543210).' });
        }
        if (!otp || otp.length !== 6) { // Schema checks min/max, but explicit check is fine
            return reply.status(400).send({ message: 'OTP must be 6 digits.' });
        }

        const isPublicContext = OTP_PUBLIC_CONTEXTS.includes(context);
        const isPrivateContext = OTP_PRIVATE_CONTEXTS.includes(context);

        if (!isPublicContext && !isPrivateContext) {
            return reply.status(400).send({ message: 'Invalid context.' });
        }

        // 2. Authentication Check for Private Contexts
        if (isPrivateContext && !request.user) {
            return reply.status(401).send({ message: 'Unauthorized: This action requires authentication.' });
        }

        // 3. Retrieve OTP Record
        let otpQuery = knex('otp_verification')
            .where({
                context,
                app: 'merchant', // Use app from request body
                identifier_type: type
            })
            .orderBy('created_at', 'desc'); // Get the latest one for this combination

        if (type === 'phone') {
            otpQuery = otpQuery.andWhere({ phone: identifier });
        } else { // type === 'email'
            otpQuery = otpQuery.andWhere({ email: identifier });
        }
        // We fetch the latest OTP regardless of its 'isVerified' status or 'attemptCount' initially
        // The checks for these conditions will happen below.
        const otpRecord = await otpQuery.first();

        fastify.log.info({ msg: 'OTP Verification Attempt', identifier, type, context, foundRecord: !!otpRecord });

        // 4. Validate OTP
        if (!otpRecord) {
            // No OTP record found for this identifier/type/context/app combination.
            // This could mean the identifier is wrong, or no OTP was sent for this specific context/app.
            return reply.status(404).send({ message: 'OTP not found or details mismatch. Please request a new OTP.' });
        }

        // Check if already verified (and not expired - an already verified OTP should not be re-verified if a new one was issued)
        // If fetching the absolute latest, an already verified one for the *same exact OTP value* might be an issue
        // if a new OTP for the same identifier/context was issued. The orderBy should get the newest.
        if (otpRecord.isVerified && otpRecord.otp === otp) { // Check if THIS specific OTP was already verified
            return reply.status(400).send({ message: 'This OTP has already been verified.' });
        }
        // If the latest record is verified but the OTP doesn't match, it means user is trying an old, verified OTP.
        // The current logic will fall into otpRecord.otp !== otp.

        // Check for expiry BEFORE checking the OTP value to prevent attempts on expired OTPs
        const createdAt = new Date(otpRecord.created_at);
        const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60000);

        if (expiresAt < new Date()) {
            return reply.status(400).send({ message: 'OTP has expired. Please request a new one.' });
        }

        // Check OTP match and attempt counts
        // This check is only relevant if the OTP record itself is NOT already marked as verified with this SAME OTP code.
        if (otpRecord.otp !== otp) {
            // Only increment attempts if the record is not yet verified or if it's a different OTP than one previously verified for this record.
            // The main concern is multiple failed attempts on the *current, unverified* OTP.
            if (!otpRecord.isVerified) { // Only increment if this OTP record instance isn't already successfully verified
                const newAttemptCount = (otpRecord.attemptCount || 0) + 1; // Handle if attemptCount is null
                try {
                    await knex('otp_verification')
                        .where({ otpId: otpRecord.otpId })
                        .update({ attemptCount: newAttemptCount });

                    if (newAttemptCount >= MAX_OTP_ATTEMPTS) {
                        // Optionally, invalidate this OTP record after too many attempts
                        // await knex('otp_verification').where({ otpId: otpRecord.otpId }).update({ isVerified: true, /* or a status like 'locked' */ });
                        return reply.status(429).send({ message: 'Too many failed attempts on this OTP. Please request a new one.' });
                    }
                } catch (dbError) {
                    fastify.log.error({ msg: 'Failed to update OTP attempt count', error: dbError, otpId: otpRecord.otpId });
                    // Continue to return invalid OTP, but log the update failure
                }
            }
            return reply.status(403).send({ message: 'Invalid OTP. Please try again.' });
        }

        // If we reach here, the OTP matches, is not expired, and this specific OTP code for this record instance
        // hasn't been marked as verified yet (or it's being re-checked within its validity, which is fine).
        // Now check the `isVerified` flag again for the record to ensure this particular OTP record isn't locked/consumed.
        if (otpRecord.isVerified) {
            // This state implies the OTP code matched an already verified record.
            // This can happen if client retries verify with the same OTP after a network glitch on first successful verify response.
            // It's generally safe to return success if the OTP *did* match a previously verified one and is still valid.
            // However, to prevent replay of the *same* OTP if a new one should have been generated,
            // the frontend flow usually ensures `verifyOtp` is called once per fresh OTP.
            // For simplicity and safety: if it's already marked verified, and it's the same OTP, treat as "already verified".
            return reply.status(400).send({ message: 'OTP session already completed.' });
        }


        // 5. Success: Mark OTP as verified
        try {
            await knex('otp_verification')
                .where({ otpId: otpRecord.otpId })
                .update({ isVerified: true, attemptCount: (otpRecord.attemptCount || 0) + 1 }); // Record the successful attempt

            return reply.status(200).send({ success: true, message: 'OTP verified successfully.' });
        } catch (dbError) {
            fastify.log.error({ msg: 'Failed to update OTP as verified', error: dbError, otpId: otpRecord.otpId });
            return reply.status(500).send({ message: 'Failed to finalize OTP verification due to a server error.' });
        }
    });
}