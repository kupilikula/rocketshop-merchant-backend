'use strict';

const knex = require('@database/knexInstance');
const axios = require('axios');
const { encryptText, decryptText } = require("../../../utils/encryption");


module.exports = async function (fastify) {
    fastify.post('/', async (request, reply) => {
        const logger = fastify.log;
        const { code, state: receivedState, storeId } = request.body;
        const initiatingMerchantId = request.user?.merchantId;

        if (!code || !receivedState || !storeId || !initiatingMerchantId) {
            return reply.status(400).send({ success: false, error: 'Missing required parameters.' });
        }

        const storeAccess = await knex('merchantStores').where({ storeId, merchantId: initiatingMerchantId }).first('merchantStoreId');
        if (!storeAccess) {
            return reply.status(403).send({ error: 'Forbidden: You do not have permission for this store.' });
        }

        const knexTx = await knex.transaction();
        let razorpayAccountId;
        try {
            // Steps 1-6: Atomic OAuth Data Processing
            const stateRecord = await knexTx('razorpay_oauth_states').where('state', receivedState).first();
            if (!stateRecord || new Date(stateRecord.expires_at) < new Date() || stateRecord.storeId !== storeId || stateRecord.merchantId !== initiatingMerchantId) {
                await knexTx.rollback();
                return reply.status(400).send({ success: false, error: 'Invalid or expired state parameter. Please try again.' });
            }
            await knexTx('razorpay_oauth_states').where({ id: stateRecord.id }).del();

            const tokenPayload = {
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.RAZORPAY_REDIRECT_URI,
                client_id: process.env.RAZORPAY_CLIENT_ID,
                client_secret: process.env.RAZORPAY_CLIENT_SECRET,
                mode: process.env.NODE_ENV==='production' ? 'live' : 'test'
            };
            const tokenResponse = await axios.post('https://auth.razorpay.com/token', tokenPayload, { headers: { 'Content-Type': 'application/json' }});
            const tokenData = tokenResponse.data;
            razorpayAccountId = tokenData.razorpay_account_id;
            if (!razorpayAccountId) throw new Error("Token response missing razorpay_account_id.");

            const credentialData = {
                razorpayAccountId, public_token: encryptText(tokenData.public_token), accessToken: encryptText(tokenData.access_token),
                refreshToken: tokenData.refresh_token ? encryptText(tokenData.refresh_token) : null,
                tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)) : null,
                grantedScopes: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : tokenData.scope,
                addedByMerchantId: initiatingMerchantId
            };

            const result = await knexTx('razorpay_credentials').insert(credentialData).onConflict('razorpayAccountId').merge().returning('credentialId');
            const credentialId = result[0]?.credentialId || (await knexTx('razorpay_credentials').where({ razorpayAccountId }).first('credentialId'))?.credentialId;
            if (!credentialId) throw new Error("Failed to find or create credential record.");

            await knexTx('store_razorpay_links').insert({ storeId, razorpayCredentialId: credentialId }).onConflict('storeId').merge({ razorpayCredentialId: credentialId, updated_at: new Date() });

            await knexTx.commit();
            logger.info({ razorpayAccountId }, `Transaction committed. Starting post-OAuth setup for store ${storeId}.`);

        } catch (error) {
            if (knexTx && !knexTx.isCompleted()) await knexTx.rollback();
            logger.error({ err: error.response?.data || error.message }, 'Error during primary OAuth transaction.');
            return reply.status(500).send({ success: false, error: 'An error occurred during account connection.' });
        }

        // Immediately return success for the OAuth part.
        return reply.send({ success: true, message: 'Razorpay account connected. Finalizing setup in the background.' });
    });
};