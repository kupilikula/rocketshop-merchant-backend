// For customer app or merchant app — choose one version per app

const knex = require('@database/knexInstance');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify) {
    fastify.get('/', async (request, reply) => {

        // --- 1. Get Store ID ---
        // IMPORTANT: Retrieve the storeId associated with the authenticated user.
        // This might come from request.user, request.session, etc., depending on your auth setup.
        // Using a placeholder here - replace with your actual logic.
        const merchantId = request.user?.merchantId; // Example: assuming auth middleware provides this
        const {storeId} = request.params;

        if (!storeId) {
            return reply.status(401).send({ error: 'Unauthorized or Store ID not found for user.' });
        }

        // --- 2. Generate Secure State ---
        const state = crypto.randomBytes(16).toString('hex'); // Generate 32 char hex string

        // --- 3. Calculate Expiration (e.g., 10 minutes from now) ---
        const expiresInMinutes = 10;
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

        // --- 4. Store State in Database ---
        try {
            await knex('razorpay_oauth_states').insert({
                state: state,
                storeId: storeId,
                expiresAt: expiresAt,
            });
            console.log(`Stored OAuth state for storeId: ${storeId}`);
        } catch (dbError) {
            console.log('Failed to store OAuth state:', dbError);
            return reply.status(500).send({ error: 'Failed to initiate OAuth flow.' });
        }

        // --- 5. Get Config from Environment Variables ---
        // Ensure these are loaded correctly (e.g., using @fastify/env or dotenv)
        const clientId = process.env.RAZORPAY_CLIENT_ID;
        const redirectUri = process.env.RAZORPAY_REDIRECT_URI;
        const scopes = process.env.RAZORPAY_SCOPES;

        if (!clientId || !redirectUri || !scopes) {
            fastify.log.error('Razorpay OAuth environment variables not configured.');
            return reply.status(500).send({ error: 'Server configuration error.' });
        }


        // --- 6. Construct Authorization URL ---
        const authorizationUrl = new URL('https://auth.razorpay.com/authorize'); // Verify exact base URL in Razorpay docs
        authorizationUrl.searchParams.append('response_type', 'code');
        authorizationUrl.searchParams.append('client_id', clientId);
        authorizationUrl.searchParams.append('redirect_uri', redirectUri);
        authorizationUrl.searchParams.append('scope', scopes);
        authorizationUrl.searchParams.append('state', state);

        // --- 7. Return URL to Frontend ---
        reply.send({ authorizationUrl: authorizationUrl.toString() });
    });
};