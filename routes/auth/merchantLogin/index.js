'use strict'

const knex = require("@database/knexInstance");
const TokenService = require('../../../services/TokenService');
const {OTP_EXPIRY_MINUTES} = require("../../../utils/constants");

module.exports = async function (fastify, opts) {
    fastify.post('/',
        {
            config: {
                rateLimit: {
                    max: 10,                    // Max 5 OTP requests
                    timeWindow: '10m',  // Per 10 minutes
                }
            }
        },
        async function (request, reply) {
        const { phone, otp } = request.body;

        if (!phone || !otp ) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Find latest OTP row for this phone + app
        const latestOtpRow = await knex('otp_verification')
            .where({ phone, context: 'AUTH_LOGIN', app: 'merchant' })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtpRow || latestOtpRow.otp !== otp || !latestOtpRow.isVerified) {
            return reply.status(401).send({ error: 'Invalid OTP' });
        }

        // Optional: Check OTP expiration again for safety (if you want)
        const createdAt = new Date(latestOtpRow.created_at);
        const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60000);
        if (expiresAt < new Date()) {
            return reply.status(400).send({ error: 'OTP has expired' });
        }

        // Find Merchant
        const merchant = await knex('merchants')
            .where({ phone })
            .first();
        console.log('merchant:', merchant);

        if (!merchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        // Get associated stores
        const stores = await knex('stores')
            .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
            .where('merchantStores.merchantId', merchant.merchantId)
            .select('stores.*');
        console.log('stores:', stores);

        // Clear all tokens for this context and app and phone
        // await knex('otp_verification').where({ phone, app: 'merchant', context: 'AUTH_LOGIN' }).del();

        // Generate tokens & send response
        await TokenService.replyWithAuthTokens(reply, merchant, stores);
    });
}