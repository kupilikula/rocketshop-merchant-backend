'use strict';

const crypto = require('crypto');
const knex = require('@database/knexInstance');
const TokenService = require('../../../../services/TokenService'); // Your Merchant TokenService

module.exports = async function (fastify, opts) {

    // Generates a token for a logged-in merchant
    fastify.post('/', async (request, reply) => {
        const { merchantId } = request.user;
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minute expiry

        await knex('autoLoginTokens').insert({
            token,
            expiresAt,
            app: 'merchant', // Hardcoded for this backend
            merchantId: merchantId,
        });

        return reply.send({ token });
    });

};