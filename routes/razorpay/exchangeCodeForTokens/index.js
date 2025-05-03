// For customer app or merchant app — choose one version per app

const knex = require('@database/knexInstance');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const {encryptToken} = require("../../../utils/encryption");

module.exports = async function (fastify) {
    fastify.post('/', async (request, reply) => {

        const { code, state: receivedState, storeId } = request.body;

        if (!storeId) {
            return reply.status(401).send({ success: false, error: 'Unauthorized or Store ID not found.' });
        }

        const knexTx = await knex.transaction(); // Use transaction for state verification/deletion

        try {
            // --- Step 1: Verify State ---
            fastify.log.info(`Verifying state for storeId: ${storeId}, state: ${receivedState}`);
            const storedState = await knexTx('oauth_states')
                .where({
                    state: receivedState,
                    storeId
                    // Optionally add storeId check if state isn't globally unique enough by itself
                    // storeId: storeId
                })
                .first(); // Get the first matching state

            if (!storedState) {
                await knexTx.rollback();
                fastify.log.warn(`Invalid or unknown state received: ${receivedState}`);
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid state parameter. Session may have expired or been tampered with.'
                });
            }

            // Check expiration (using current time on the server)
            if (new Date(storedState.expiresAt) < new Date()) {
                await knexTx.rollback();
                fastify.log.warn(`Expired state received: ${receivedState}`);
                // Clean up expired state (optional here, could have a separate cleanup job)
                // await knex('oauth_states').where({ id: storedState.id }).del();
                return reply.status(400).send({success: false, error: 'OAuth session expired. Please try again.'});
            }

            // Check if state belongs to the correct store (important if state isn't globally unique)
            if (storedState.storeId !== storeId) {
                await knexTx.rollback();
                fastify.log.error(`State mismatch for storeId: received state for store ${storedState.storeId}, expected ${storeId}`);
                return reply.status(403).send({success: false, error: 'State parameter mismatch.'});
            }


            // State is valid, delete it immediately to prevent reuse
            await knexTx('oauth_states').where({id: storedState.id}).del();
            fastify.log.info(`State verified and deleted: ${receivedState}`);

            // --- Step 2: Exchange Code for Tokens with Razorpay ---
            const clientId = process.env.RAZORPAY_CLIENT_ID;
            const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
            const redirectUri = process.env.RAZORPAY_REDIRECT_URI; // Must match initial request

            if (!clientId || !clientSecret || !redirectUri) {
                await knexTx.rollback(); // Rollback state deletion if config is bad
                fastify.log.error('Razorpay OAuth client credentials or redirect URI missing.');
                return reply.status(500).send({success: false, error: 'Server configuration error.'});
            }

            // Prepare Basic Auth header
            const basicAuthToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

            fastify.log.info(`Requesting tokens from Razorpay for code: ${code.substring(0, 5)}...`);

            const tokenResponse = await axios.post('https://auth.razorpay.com/token', new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                client_id: clientId,
                client_secret: clientSecret,
            }), {
                headers: {
                    'Authorization': `Basic ${basicAuthToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                validateStatus: status => status < 500 // Handle 4xx errors gracefully
            });

            if (tokenResponse.status >= 400) {
                await knexTx.rollback(); // Rollback state deletion
                fastify.log.error('Razorpay token exchange failed:', tokenResponse.data);
                const errorMessage = tokenResponse.data?.error_description || tokenResponse.data?.error || 'Failed to exchange code with Razorpay.';
                return reply.status(400).send({success: false, error: errorMessage});
            }

            const tokenData = tokenResponse.data;
            fastify.log.info('Received tokens from Razorpay:', Object.keys(tokenData));

            // --- Step 3: Store Tokens Securely ---
            const {
                access_token,
                refresh_token, // May be null
                expires_in,    // Seconds
                scope,         // Granted scopes string
                account_id     // Merchant's Razorpay Account ID
            } = tokenData;

            // Calculate expiration timestamp
            const expiresAt = new Date(Date.now() + (expires_in * 1000));

            // !!! IMPORTANT: Encrypt tokens before storing !!!
            const encryptedAccessToken = encryptToken(access_token); // Replace with your actual encryption function
            const encryptedRefreshToken = refresh_token ? encryptToken(refresh_token) : null; // Encrypt if exists
            // Prepare data for insertion into the new table
            const newRazorpayAccountData = {
                storeId: storeId,
                razorpayAccountId: account_id,
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                tokenExpiresAt: expiresAt,
                grantedScopes: scope,
                // createdAt and updatedAt will be handled by timestamps(true, true)
            };

            // Insert the new record into razorpay_accounts table
            // Use ON CONFLICT for robustness if needed (e.g., if user somehow tries to connect twice quickly)
            // This simple insert assumes a clean first-time connection per storeId
            await knexTx('razorpay_accounts').insert(newRazorpayAccountData);
            fastify.log.info(`Successfully created Razorpay account link for storeId: ${storeId}`);

            // If all steps succeeded, commit the transaction
            await knexTx.commit();

            // --- Step 4: Reply to Frontend ---
            reply.send({success: true, message: 'Razorpay account connected successfully.'});
        }
        catch (error) {
            // Rollback transaction if any error occurred
            if (knexTx && !knexTx.isCompleted()) {
                await knexTx.rollback();
            }
            fastify.log.error('Error in /exchange route:', error);
            // Check for specific errors like unique constraint violation if needed
            if (error.code === '23505') { // Postgres unique violation code
                if (error.constraint === 'razorpay_accounts_storeid_unique') {
                    return reply.status(409).send({ success: false, error: 'This store is already linked to a Razorpay account.' });
                }
                if (error.constraint === 'razorpay_accounts_razorpayaccountid_unique') {
                    return reply.status(409).send({ success: false, error: 'This Razorpay account is already linked to another store.' });
                }
            }
            reply.status(500).send({ success: false, error: 'An internal server error occurred.' });
        }
    })
};