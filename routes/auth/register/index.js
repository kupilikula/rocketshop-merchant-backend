'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');
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
        const { phone, otp, fullName } = request.body;

        if (!phone || !otp || !fullName) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Check if merchant already exists
        const existingMerchant = await knex('merchants')
            .where({ phone })
            .first();

        if (existingMerchant) {
            return reply.status(400).send({ error: 'Merchant already registered' });
        }

        // Verify latest OTP
        const latestOtpRow = await knex('otp_verification')
            .where({ phone, context: 'AUTH_LOGIN', app: 'merchant' })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtpRow || latestOtpRow.otp !== otp || !latestOtpRow.isVerified) {
            return reply.status(401).send({ error: 'Invalid or unverified OTP' });
        }

        // Optional: Check OTP expiry again for safety
        const createdAt = new Date(latestOtpRow.created_at);
        const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60000);
        if (expiresAt < new Date()) {
            return reply.status(400).send({ error: 'OTP has expired' });
        }

        // Clear all tokens for this context and app and phone
        await knex('otp_verification').where({ phone, app: 'merchant', context: 'AUTH_LOGIN' }).del();


        // Create new merchant
        const merchantId = uuidv4();

        const [merchant] = await knex('merchants')
            .insert({
                merchantId,
                fullName,
                phone,
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