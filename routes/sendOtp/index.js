'use strict';

const knex = require("@database/knexInstance");
const { generateOtp } = require("../../utils/generateOtp");
const { OTP_PUBLIC_CONTEXTS, OTP_PRIVATE_CONTEXTS } = require("../../utils/OtpContexts");
const {getOtpText} = require("../../utils/getOtpText");
const smsService = require("../../services/SMSService");
const {isValidEmail, isValidE164Phone} = require("../../utils/validateIdentifier"); // Import the class instead


module.exports = async function (fastify, opts) {
    fastify.post('/',     {
            config: {
                rateLimit: {
                    max: 5,                    // Max 5 OTP requests
                    timeWindow: '10m',  // Per 10 minutes
                }
            }
        },
        async function (request, reply) {
        const { identifier, type, context, storeId } = request.body;
            let effectiveIdentifier = identifier; // This might be overridden by context logic
            let effectiveType = type;

        if (!identifier || !type || !context) {
            return reply.status(400).send({ error: 'Phone number and context are required' });
        }

            if (type === 'email' && !isValidEmail(identifier)) {
                return reply.status(400).send({ message: 'Invalid email format provided.' });
            } else if (type === 'phone' && !isValidE164Phone(identifier)) {
                return reply.status(400).send({ message: 'Invalid phone number format. Expected E.164 (e.g., +919876543210).' });
            }

        const isPublicContext = OTP_PUBLIC_CONTEXTS.includes(context);
        const isPrivateContext = OTP_PRIVATE_CONTEXTS.includes(context);

        if (!isPublicContext && !isPrivateContext) {
            return reply.status(400).send({ error: 'Invalid context' });
        }

        // For private contexts, user must be authenticated
        if (isPrivateContext && !request.user) {
            return reply.status(401).send({ error: 'Unauthorized: This action requires authentication.' });
        }

        const requestingMerchantId = request.user?.merchantId;

        try {
            // Context-specific logic
            if (context === 'DEACTIVATE_STORE' || context === 'DELETE_STORE' || context === 'ACTIVATE_STORE') {
                if (!storeId) {
                    return reply.status(400).send({error: 'Missing storeId for store action context'});
                }

                if (!requestingMerchantId) {
                    return reply.status(401).send({error: 'Unauthorized'});
                }


                const merchantStoreLink = await knex('merchantStores')
                    .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
                    .where('merchantStores.storeId', storeId)
                    .andWhere('merchantStores.merchantId', requestingMerchantId)
                    .select('merchants.phone as merchantPhone', 'merchants.email as merchantEmail', 'merchantStores.merchantRole')
                    .first();

                if (!merchantStoreLink || merchantStoreLink.merchantRole !== 'Admin') {
                    return reply.status(403).send({error: 'Only Admin merchants can perform this action.'});
                }
                if (type === 'phone') {
                    if (!merchantStoreLink.merchantPhone) {
                        return reply.status(400).send({message: 'Admin merchant does not have a registered phone number for this action.'});
                    }
                    effectiveIdentifier = merchantStoreLink.merchantPhone;
                    effectiveType = 'phone';
                } else if (type === 'email') {
                    if (!merchantStoreLink.merchantEmail) {
                        return reply.status(400).send({message: 'Admin merchant does not have a registered email for this action.'});
                    }
                    effectiveIdentifier = merchantStoreLink.merchantEmail;
                    effectiveType = 'email';
                } else {
                    return reply.status(400).send({message: 'Invalid type specified for store action OTP.'});
                }

            }

            if (context === 'UPDATE_PHONE') {

                if (type !== 'phone') {
                    return reply.status(400).send({message: 'Invalid type for UPDATE_PHONE context. Must be "phone".'});
                }
                if (!requestingMerchantId) return reply.status(401).send({message: 'Unauthorized.'});

                const existingMerchantWithNewPhone = await knex('merchants')
                    .where({phone: identifier}) // `identifier` is the new phone
                    .andWhereNot({merchantId: requestingMerchantId})
                    .first();
                if (existingMerchantWithNewPhone) {
                    return reply.status(409).send({message: 'Phone number already in use by another account.'}); // 409 Conflict
                }
                const selfMerchant = await knex('merchants').where({merchantId: requestingMerchantId}).first();
                if (selfMerchant?.phone === identifier) {
                    return reply.status(400).send({message: 'This is already your current phone number.'});
                }
                effectiveIdentifier = identifier; // The new phone number
                effectiveType = 'phone';
            }
            if (context === 'UPDATE_EMAIL') { // New context
                if (type !== 'email') {
                    return reply.status(400).send({message: 'Invalid type for UPDATE_EMAIL context. Must be "email".'});
                }
                if (!requestingMerchantId) return reply.status(401).send({message: 'Unauthorized.'});

                const existingMerchantWithNewEmail = await knex('merchants')
                    .where({email: identifier}) // `identifier` is the new email
                    .andWhereNot({merchantId: requestingMerchantId})
                    .first();
                if (existingMerchantWithNewEmail) {
                    return reply.status(409).send({message: 'Email address already in use by another account.'}); // 409 Conflict
                }
                const selfMerchant = await knex('merchants').where({merchantId: requestingMerchantId}).first();
                if (selfMerchant?.email === identifier) {
                    return reply.status(400).send({message: 'This is already your current email address.'});
                }
                effectiveIdentifier = identifier; // The new email address
                effectiveType = 'email';
            } else if (context === 'AUTH_LOGIN') {
                // effectiveIdentifier and effectiveType are already set from request.body
            }
        } catch (error) {
            console.error('Error in sendOtp context logic:', error);
            return reply.status(500).send({ error: 'Internal server error' });
        }


        // Generate 6-digit OTP
        const otp = generateOtp();

            const otpData = {
                otp,
                context,
                app: 'merchant', // Use app from request body, default to 'merchant'
                identifier_type: effectiveType,
                isVerified: false,
                created_at: knex.fn.now(),
                // Consider adding expires_at: knex.raw("NOW() + INTERVAL '5 minutes'")
            };
            if (effectiveType === 'phone') {
                otpData.phone = effectiveIdentifier;
            } else { // 'email'
                otpData.email = effectiveIdentifier;
            }

            try {
                await knex('otp_verification').insert(otpData);
            } catch (dbError) {
                fastify.log.error({ msg: 'Failed to store OTP', error: dbError, identifier: effectiveIdentifier, type: effectiveType, context });
                return reply.status(500).send({ message: 'Failed to process OTP request due to a server error.' });
            }

        console.log(`Sending OTP ${otp} to ${effectiveType} ${effectiveIdentifier} for context ${context}`);

            try {
                const message = getOtpText(otp, context); // getOtpText might use context
                if (effectiveType === 'email') {
                    // await emailService.sendOtpEmail(effectiveIdentifier, message);
                } else if (effectiveType==='phone'){
                    // await smsService.sendSMS(effectiveIdentifier.slice(1), message);
                }
            } catch (sendError) {
                console.error({ msg: 'Failed to send OTP message', error: sendError, identifier: effectiveIdentifier, type: effectiveType });
                // Critical decision: If sending fails, should the OTP be invalidated/deleted?
                // For now, returning an error to the client.
                if (type==='phone') {
                    await knex('otp_verification')
                        .where({ phone: effectiveIdentifier, otp })
                        .delete();
                } else if (type==='email') {
                    await knex('otp_verification')
                        .where({ email: effectiveIdentifier, otp })
                        .delete();

                }
                return reply.status(500).send({ message: `Failed to send OTP via ${effectiveType}. Please try again.` });
            }

        // Generate OTP message and send SMS
        // try {
        //     const message = getOtpText(otp);
        //     await smsService.sendSMS(request.body.phone, message);
        // } catch (error) {
        //     console.error('Failed to send OTP SMS:', error);
        //     // Optionally, you might want to delete the OTP record if SMS fails
        //     await knex('otp_verification')
        //         .where({ phone: request.body.phone, otp })
        //         .delete();
        //     return reply.status(500).send({ error: 'Failed to send OTP' });
        // }


        // Special response for login flow
            if (context === 'AUTH_LOGIN') {
                try {
                    let existingMerchantQuery = knex('merchants');
                    if (effectiveType === 'phone') {
                        existingMerchantQuery = existingMerchantQuery.where({ phone: effectiveIdentifier });
                    } else { // 'email'
                        existingMerchantQuery = existingMerchantQuery.where({ email: effectiveIdentifier });
                    }
                    const existingMerchant = await existingMerchantQuery.first();
                    return reply.status(200).send({
                        message: 'OTP sent successfully.',
                        isRegistered: !!existingMerchant
                    });
                } catch (dbError) {
                    fastify.log.error({ msg: 'Error checking merchant registration status for AUTH_LOGIN', error: dbError, identifier: effectiveIdentifier, type: effectiveType });
                    return reply.status(200).send({ // Still send 200 as OTP was sent, but log error.
                        message: 'OTP sent successfully. Error checking registration status.',
                        isRegistered: false // Default to false on error to be safe for registration flow
                    });
                }
            }

            return reply.status(200).send({ success: true, message: 'OTP sent successfully.' });
    });
};