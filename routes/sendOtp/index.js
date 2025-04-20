'use strict';

const knex = require("@database/knexInstance");
const { generateOtp } = require("../../utils/generateOtp");
const { OTP_PUBLIC_CONTEXTS, OTP_PRIVATE_CONTEXTS } = require("../../utils/OtpContexts");
const {getOtpText} = require("../../utils/getOtpText");
const smsService = require("../../services/SMSService"); // Import the class instead


module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { phone, context, storeId } = request.body;

        if (!phone || !context) {
            return reply.status(400).send({ error: 'Phone number and context are required' });
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

        // Context-specific logic
        if (context === 'DEACTIVATE_STORE' || context === 'DELETE_STORE' || context === 'ACTIVATE_STORE') {
            if (!storeId) {
                return reply.status(400).send({ error: 'Missing storeId for store action context' });
            }

            const requestingMerchantId = request.user.merchantId;

            const merchant = await knex('merchantStores')
                .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
                .where('merchantStores.storeId', storeId)
                .andWhere('merchantStores.merchantId', requestingMerchantId)
                .first();

            if (!merchant || merchant.merchantRole !== 'Admin') {
                return reply.status(403).send({ error: 'Only Admin merchants can perform this action.' });
            }

            // Overwrite the phone with the verified phone from DB
            // (Prevents a malicious actor from injecting a different phone)
            request.body.phone = merchant.phone;
        }

        if (context === 'UPDATE_PHONE') {
            const requestingMerchantId = request.user?.merchantId;

            if (!requestingMerchantId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const existingMerchant = await knex('merchants')
                .where({ phone })
                .andWhereNot({ merchantId: requestingMerchantId })
                .first();

            if (existingMerchant) {
                return reply.status(400).send({ error: 'Phone number already in use by another account.' });
            }

            // Optional: prevent sending OTP if phone is unchanged
            const selfMerchant = await knex('merchants')
                .where({ merchantId: requestingMerchantId })
                .first();

            if (selfMerchant?.phone === phone) {
                return reply.status(400).send({ error: 'Phone number is already your current number.' });
            }
        }

        // Generate 6-digit OTP
        const otp = generateOtp();

        await knex('otp_verification').insert({
            phone: request.body.phone,
            otp,
            app: 'merchant',
            context,
            isVerified: false,
            created_at: knex.fn.now()
        });

        console.log(`Sending OTP ${otp} to phone ${request.body.phone} for context ${context}`);

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
            const existingMerchant = await knex('merchants')
                .where({ phone })
                .first();

            return reply.status(200).send({
                isRegistered: !!existingMerchant
            });
        }

        return reply.send({ success: true });
    });
};