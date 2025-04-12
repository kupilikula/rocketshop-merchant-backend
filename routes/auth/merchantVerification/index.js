'use strict'

const knex = require("@database/knexInstance");
const TokenService = require('../../../services/TokenService');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { phone, otp, app } = request.body;

        if (!phone || !otp || !app || app !== 'merchant') {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Find latest OTP row for this phone + app
        const latestOtpRow = await knex('otp_verification')
            .where({ phone, app })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtpRow || latestOtpRow.otp !== otp || !latestOtpRow.isVerified) {
            return reply.status(401).send({ error: 'Invalid or expired OTP' });
        }

        // Find Merchant
        const merchant = await knex('merchants')
            .where({ merchantPhone: phone })
            .first();

        if (!merchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        // Get associated stores
        const stores = await knex('stores')
            .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
            .where('merchantStores.merchantId', merchant.merchantId)
            .select('stores.*');

        // Generate tokens & send response
        await TokenService.replyWithAuthTokens(reply, merchant, stores);
    });
}