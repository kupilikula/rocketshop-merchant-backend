// src/routes/stores/razorpayConnection.js (Example Path)

'use strict';

const knex = require('@database/knexInstance'); // <<< ADJUST path to your Knex instance
const axios = require('axios'); // Required for live API call

// Using v2 based on your curl example. Double-check if v1 is more appropriate for GET /accounts/{id}
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v2';
const API_TIMEOUT = 7000; // Timeout for Razorpay API call in milliseconds (e.g., 7 seconds)

module.exports = async function (fastify, opts) {

    // Define the GET route
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const merchantId = request.user?.merchantId; // Assumes auth middleware provides this
        const logger = fastify.log; // Use Fastify's built-in logger

        // 1. Authorization Check: Ensure the logged-in merchant can access this store
        if (!merchantId) {
            logger.warn({ storeId }, 'MerchantId missing during razorpay connection status check.');
            return reply.status(403).send({ error: 'Forbidden: Authentication required.' });
        }

        try {
            const storeAccess = await knex('merchantStores')
                .where({ storeId: storeId, merchantId: merchantId })
                .first('merchantStoreId'); // Check if relationship exists

            if (!storeAccess) {
                logger.warn({ merchantId, storeId }, 'Merchant forbidden from accessing store razorpay status.');
                return reply.status(403).send({ error: 'Forbidden: Access denied to this store.' });
            }

            // 2. Check for Local Link and Get Razorpay Account ID
            logger.info({ storeId }, 'Checking local Razorpay link for store.');
            // Join stores -> links -> credentials to get the razorpayAccountId (acc_...)
            const link = await knex('stores as s')
                .innerJoin('store_razorpay_links as srl', 's.storeId', 'srl.storeId')
                .innerJoin('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .select('rc.razorpayAccountId')
                .where('s.storeId', storeId)
                .first();

            // 3. If no link exists locally, return disconnected status
            if (!link || !link.razorpayAccountId) {
                logger.info({ storeId }, 'No active Razorpay link found locally for store.');
                return reply.send({
                    isConnected: false,
                    accountId: null,
                    name: null,
                    email: null,
                    status: null,
                    error: null
                });
            }

            // 4. If linked locally, Fetch LIVE Details from Razorpay API
            const razorpayAccountId = link.razorpayAccountId;
            logger.info({ storeId, razorpayAccountId }, 'Local link found. Fetching live details from Razorpay API...');

            // Get YOUR platform's API keys (Test or Live based on environment)
            const keyId = process.env.RAZORPAY_KEY_ID;
            const keySecret = process.env.RAZORPAY_KEY_SECRET;

            if (!keyId || !keySecret) {
                logger.error({ storeId, razorpayAccountId }, "Razorpay API Keys (KEY_ID, KEY_SECRET) are not configured on backend.");
                // Return connected based on local data, but indicate details couldn't be fetched
                return reply.status(500).send({
                    isConnected: true, // Link exists locally
                    accountId: razorpayAccountId,
                    name: null, email: null, status: null,
                    error: 'Server configuration error prevented fetching live details.'
                });
            }

            // Prepare Basic Auth header using YOUR platform API keys
            const basicAuthToken = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const accountApiUrl = `${RAZORPAY_API_BASE}/accounts/${razorpayAccountId}`;

            let accountName = null;
            let accountEmail = null;
            let accountStatus = null;
            let detailError = null; // Store specific error message if API fails

            try {
                const razorpayResponse = await axios.get(accountApiUrl, {
                    headers: {
                        'Authorization': `Basic ${basicAuthToken}`,
                        'Content-Type': 'application/json' // Important for Razorpay APIs
                    },
                    timeout: API_TIMEOUT // Prevent hanging indefinitely
                });

                const accountData = razorpayResponse.data;
                logger.info({ storeId, razorpayAccountId }, 'Successfully fetched details from Razorpay API.');

                // Extract details based on the sample response provided
                accountName = accountData?.customer_facing_business_name
                    || accountData?.legal_business_name
                    || accountData?.contact_name
                    || null; // Fallback to null
                accountEmail = accountData?.email || null; // Top-level email
                accountStatus = accountData?.status || null; // e.g., 'created', 'activated'

            } catch (razorpayError) {
                const errorResponseData = razorpayError.response?.data?.error;
                logger.error({
                    err: errorResponseData || razorpayError.message, // Log RZP specific error or general message
                    status: razorpayError.response?.status,
                    code: razorpayError.code, // e.g., ECONNABORTED
                    storeId,
                    razorpayAccountId
                }, 'Error fetching details from Razorpay Account API.');

                // Create user-friendly error message based on common cases
                if (razorpayError.response?.status === 404 || errorResponseData?.reason === 'linked_account_id_does_not_exist') {
                    detailError = 'Linked Razorpay account not found on Razorpay (may have been deleted/disconnected).';
                    // Consider if you should delete the local link here too? Risky if temporary API issue.
                } else if (razorpayError.response?.status === 401 || razorpayError.response?.status === 403) {
                    detailError = 'Server authentication error with Razorpay API (check API keys).';
                } else if (razorpayError.code === 'ECONNABORTED' || razorpayError.message.includes('timeout')) {
                    detailError = `Timeout fetching details from Razorpay (limit: ${API_TIMEOUT}ms).`;
                } else {
                    // Use description from RZP error if available, else generic message
                    detailError = errorResponseData?.description || 'Could not fetch live details from Razorpay.';
                }
            }

            // 5. Return the final combined status and details (or error message for details)
            return reply.send({
                isConnected: true, // We know this from the local 'link' check
                accountId: razorpayAccountId,
                name: accountName,
                email: accountEmail,
                status: accountStatus,
                error: detailError // Null if API call succeeded, error message otherwise
            });

        } catch (dbError) {
            // Catch errors from the initial database queries or other unexpected issues
            logger.error({ err: dbError, storeId, merchantId }, 'Error during razorpay connection status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};