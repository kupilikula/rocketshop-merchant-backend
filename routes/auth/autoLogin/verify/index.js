'use strict';

const crypto = require('crypto');
const knex = require('@database/knexInstance');
const TokenService = require('../../../../services/TokenService'); // Your Merchant TokenService

module.exports = async function (fastify, opts) {

    // Verifies a token and logs in a merchant
    fastify.post('/', async (request, reply) => {
        const { token } = request.body;
        if (!token) return reply.status(400).send({ error: 'Token is required.' });

        const tokenRecord = await knex('autoLoginTokens').where({ token }).first();
        console.log('tokenRecord:',tokenRecord);
        // Security checks
        if (!tokenRecord || tokenRecord.isUsed || new Date(tokenRecord.expiresAt) < new Date()) {
            return reply.status(401).send({ error: 'Invalid or expired login link.' });
        }

        // CRITICAL: Ensure this token was generated for the merchant app
        if (tokenRecord.app !== 'merchant' || !tokenRecord.merchantId) {
            return reply.status(403).send({ error: 'This login link is not valid for this application.' });
        }

        await knex('autoLoginTokens').where({ id: tokenRecord.id }).update({ isUsed: true });

        const merchant = await knex('merchants').where({ merchantId: tokenRecord.merchantId }).first();
        if (!merchant) return reply.status(404).send({ error: 'Associated merchant account not found.' });

        const stores = await knex('stores')
            .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
            .where('merchantStores.merchantId', merchant.merchantId)
            .select('stores.*');

        await TokenService.replyWithAuthTokens(reply, merchant, stores);
    });
};