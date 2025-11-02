'use strict';

const knex = require('@database/knexInstance');
const crypto = require('crypto');

const RAZORPAY_AUTHORIZATION_ENDPOINT = 'https://auth.razorpay.com/authorize';
const OAUTH_STATE_EXPIRY_MINUTES = 10;

module.exports = async function (fastify) {
    // REFACTORED: Changed to GET as no request body is needed.
    fastify.get('/', async (request, reply) => {
        const logger = fastify.log;
        const merchantId = request.user?.merchantId;
        const { storeId, platform, env } = request.query;

        // 1. --- Validate Inputs ---
        if (!merchantId) {
            return reply.status(403).send({ error: 'Forbidden: Merchant identifier missing.' });
        }
        if (!storeId || !platform || !env) {
            return reply.status(400).send({ error: 'Bad Request: storeId, platform, and env query parameters are required.' });
        }
        logger.info({ merchantId, storeId }, "Initiating OAuth for store.");

        const trx = await knex.transaction();
        try {
            // 2. --- Verify Merchant Access to the Store ---
            const storeAccess = await trx('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first('merchantStoreId');

            if (!storeAccess) {
                await trx.rollback();
                return reply.status(403).send({ error: 'Forbidden: You do not have permission for this store.' });
            }
            logger.info({ merchantId, storeId }, 'Store access verified.');

            // 3. --- Generate and Store Secure State ---
            const prefix = `${platform}_${env}_`;
            const state = prefix + crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY_MINUTES * 60 * 1000);

            await trx('razorpay_oauth_states').insert({
                state: state,
                storeId: storeId,
                merchantId: merchantId,
                expires_at: expiresAt,
            });
            logger.info({ state: state.substring(0, 10) + '...', storeId }, 'Stored OAuth state in DB.');

            await trx.commit();
            logger.info({ storeId }, "Committed OAuth state to DB successfully.");

            // 4. --- Get Config from Environment Variables ---
            const clientId = process.env.RAZORPAY_CLIENT_ID;
            const redirectUri = process.env.RAZORPAY_REDIRECT_URI;
            const scopes = process.env.RAZORPAY_SCOPES;

            if (!clientId || !redirectUri || !scopes) {
                logger.error('Razorpay OAuth environment variables missing (CLIENT_ID, REDIRECT_URI, SCOPES).');
                return reply.status(500).send({ error: 'Server configuration error.' });
            }

            // 5. --- Prepare and Return Response Payload for Frontend ---
            const responsePayload = {
                authorizationEndpoint: RAZORPAY_AUTHORIZATION_ENDPOINT,
                clientId: clientId,
                scopes: scopes,
                state: state,
                redirectUri: redirectUri
            };
            return reply.send(responsePayload);

        } catch (error) {
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            logger.error({ err: error, storeId, merchantId }, 'Unexpected error during OAuth initiation.');
            return reply.status(500).send({ error: 'An unexpected server error occurred.' });
        }
    });
};