// routes/razorpay/initiateOAuthParams.js (Example new file/route path)

'use strict';

const knex = require('@database/knexInstance'); // Adjust path if needed
const crypto = require('crypto');

// --- Configuration ---
// Razorpay's static authorization endpoint URL (confirm from their docs)
const RAZORPAY_AUTHORIZATION_ENDPOINT = 'https://auth.razorpay.com/authorize';
const OAUTH_STATE_EXPIRY_MINUTES = 10; // How long the state is valid

module.exports = async function (fastify) {

    // Consider changing the route path if necessary, e.g., '/params' if mounted under /initiateOAuth
    fastify.get('/', async (request, reply) => {

        // --- 1. Get Store ID & Validate Merchant Access ---
        // Assumes your authentication middleware adds 'user' object with 'merchantId'
        const merchantId = request.user?.merchantId;
        const { storeId, platform, env } = request.query;

        // Validate input
        if (!merchantId) {
            fastify.log.warn('Merchant ID missing from authenticated request in initiateOAuthParams');
            // Use 403 Forbidden as it's an access issue, not bad request syntax
            return reply.status(403).send({ error: 'Forbidden: Merchant identifier missing.' });
        }
        if (!storeId) {
            return reply.status(400).send({ error: 'Bad Request: storeId query parameter is required.' });
        }

        try {
            // Check if this merchant is associated with the requested storeId
            const storeAccess = await knex('merchantStores')
                .where({ storeId, merchantId })
                .first('merchantStoreId'); // Just check for existence

            if (!storeAccess) {
                fastify.log.warn({ merchantId, storeId }, 'Forbidden attempt to initiate OAuth for store.');
                return reply.status(403).send({ error: 'Forbidden: You do not have permission for this store.' });
            }
            fastify.log.info({ merchantId, storeId }, 'Store access verified for OAuth initiation.');

            // --- 2. Generate Secure State ---
            const prefix = platform + '_' + env + '_';
            const state = prefix + crypto.randomBytes(16).toString('hex');
            fastify.log.info({ state: state.substring(0, 5) + '...', storeId }, 'Generated OAuth state.'); // Log truncated state

            // --- 3. Calculate Expiration ---
            const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY_MINUTES * 60 * 1000);

            // --- 4. Store State in Database ---
            try {
                await knex('razorpay_oauth_states').insert({
                    // Assuming your table has auto-generated primary key (like UUID default)
                    state: state,
                    storeId: storeId,
                    expires_at: expiresAt,
                });
                fastify.log.info({ state: state.substring(0, 10) + '...', storeId, expiresAt }, 'Stored OAuth state in DB.');
            } catch (dbError) {
                fastify.log.error({ err: dbError, storeId }, 'Database error storing OAuth state.');
                return reply.status(500).send({ error: 'Internal Server Error: Failed to initiate OAuth flow.' });
            }

            // --- 5. Get Config from Environment Variables ---
            // Ensure these env vars are set correctly for the running environment (QA/Prod)
            const clientId = process.env.RAZORPAY_CLIENT_ID;
            const redirectUri = process.env.RAZORPAY_REDIRECT_URI;
            const scopes = process.env.RAZORPAY_SCOPES;       // e.g., 'read_write'

            if (!clientId || !redirectUri || !scopes) {
                fastify.log.error('Razorpay OAuth environment variables missing (CLIENT_ID, REDIRECT_URI, SCOPES).');
                return reply.status(500).send({ error: 'Server configuration error.' });
            }

            // --- 6. Prepare Response Payload for Frontend ---
            const responsePayload = {
                authorizationEndpoint: RAZORPAY_AUTHORIZATION_ENDPOINT, // The base URL for auth
                clientId: clientId,                   // Your app's client ID
                scopes: scopes,                       // Space-separated string of scopes
                state: state,                         // The unique state for this request
                redirectUri: redirectUri              // The URI Razorpay must redirect to
                // responseType: 'code' // Not needed here, expo-auth-session adds it
            };
            fastify.log.info({ clientId, redirectUri, scopes, state: state.substring(0,5)+'...'}, 'Returning OAuth parameters to frontend.');

            // --- 7. Return Parameters to Frontend ---
            // Instead of the full URL, send the object with parameters
            return reply.send(responsePayload);

        } catch (error) {
            // Catch any unexpected errors (like DB connection issues during store check)
            fastify.log.error({ err: error, storeId, merchantId }, 'Unexpected error during OAuth parameter initiation.');
            return reply.status(500).send({ error: 'An unexpected server error occurred.' });
        }
    });
};