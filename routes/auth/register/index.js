'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');
const TokenService = require('../../../services/TokenService');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { phone, otp, fullName, app } = request.body;

        if (!phone || !otp || !fullName || app !== 'merchant') {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Check if merchant already exists
        const existingMerchant = await knex('merchants')
            .where({ merchantPhone: phone })
            .first();

        if (existingMerchant) {
            return reply.status(400).send({ error: 'Merchant already registered' });
        }

        // Verify latest OTP
        const latestOtpRow = await knex('otp_verification')
            .where({ phone, app })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtpRow || latestOtpRow.otp !== otp || !latestOtpRow.isVerified) {
            return reply.status(401).send({ error: 'Invalid or unverified OTP' });
        }

        // Create new merchant
        const merchantId = uuidv4();

        const [merchant] = await knex('merchants')
            .insert({
                merchantId,
                merchantName: fullName,
                merchantPhone: phone,
                merchantRole: 'Admin', // Default role
                created_at: knex.fn.now(),
            })
            .returning('*');

        if (!merchant) {
            return reply.status(500).send({ error: 'Failed to create merchant' });
        }

        // Generate tokens
        await TokenService.replyWithAuthTokens(reply, merchant, []);
    });
}