// routes/razorpay/initiateOAuth.js
// This endpoint now handles bank details and should be a POST request.

'use strict';

const knex = require('@database/knexInstance'); // Adjust path to your Knex instance
const crypto = require('crypto');
// Use the exact function name from your utility file
const { encryptText } = require('../../../utils/encryption'); // <<< Adjust path to your encryption.js file

// --- Configuration ---
const RAZORPAY_AUTHORIZATION_ENDPOINT = 'https://auth.razorpay.com/authorize';
const OAUTH_STATE_EXPIRY_MINUTES = 10;

module.exports = async function (fastify) {

    // IMPORTANT: Method is POST to securely accept bank details in the request body
    fastify.post('/', async (request, reply) => {
        const logger = fastify.log;
        const merchantId = request.user?.merchantId;

        // Destructure from query and body
        const { storeId, platform, env } = request.query;
        const {legalBusinessName, account_number, ifsc_code, beneficiary_name, stakeholder_name, stakeholder_email, stakeholder_pan } = request.body;

        // --- 1. Validate All Inputs ---
        if (!merchantId) {
            logger.warn('Merchant ID missing from authenticated request in initiateOAuth');
            return reply.status(403).send({ error: 'Forbidden: Merchant identifier missing.' });
        }
        if (!storeId || !platform || !env) {
            return reply.status(400).send({ error: 'Bad Request: storeId, platform, and env query parameters are required.' });
        }
        if (!legalBusinessName || !account_number || !ifsc_code || !beneficiary_name || !stakeholder_name || !stakeholder_email || !stakeholder_pan) {
            return reply.status(400).send({ error: 'Bad Request: account_number, ifsc_code, beneficiary_name and stakeholder details are required in the request body.' });
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc_code.toUpperCase())) {
            return reply.status(400).send({ error: 'Invalid IFSC code format.' });
        }
        logger.info({ merchantId, storeId }, "Initiating OAuth and saving bank details for store.");

        const trx = await knex.transaction(); // Use a transaction for atomicity

        try {
            // --- 2. Verify Merchant Access to the Store ---
            const storeAccess = await trx('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first('merchantStoreId');

            if (!storeAccess) {
                await trx.rollback();
                logger.warn({ merchantId, storeId }, 'Forbidden attempt to initiate OAuth for store.');
                return reply.status(403).send({ error: 'Forbidden: You do not have permission for this store.' });
            }
            logger.info({ merchantId, storeId }, 'Store access verified.');

            // --- 3. Encrypt and Upsert (Insert or Update) Bank Details ---
            await trx('merchants')
                .where({ merchantId })
                .update({ legalBusinessName });
            logger.info({ merchantId }, 'Successfully updated legalBusinessName.');

            const financialsPayload = {
                merchantId: merchantId, // The Primary and Foreign Key for store_bank_accounts
                beneficiaryName_encrypted: encryptText(beneficiary_name),
                accountNumber_encrypted: encryptText(account_number),
                ifscCode_encrypted: encryptText(ifsc_code),
                stakeholder_name_encrypted: encryptText(stakeholder_name),
                stakeholder_email_encrypted: encryptText(stakeholder_email),
                stakeholder_pan_encrypted: encryptText(stakeholder_pan),
                updated_at: new Date()
            };

            // Check if encryption returned empty strings, indicating an error (e.g., missing key)
            if (!financialsPayload.beneficiaryName_encrypted || !financialsPayload.accountNumber_encrypted || !financialsPayload.ifscCode_encrypted) {
                logger.error({ storeId }, "Encryption failed, likely due to missing ENCRYPTION_KEY. Aborting.");
                // Do not rollback yet, just throw to be caught by the main catch block which will rollback.
                throw new Error("Server encryption configuration error.");
            }

            await trx('merchant_financials')
                .insert(financialsPayload)
                .onConflict('merchantId').merge(); // Upsert based on merchantId

            logger.info({ merchantId }, 'Successfully saved/updated merchant financial details.');

            // --- 4. Generate and Store Secure State (within the same transaction) ---
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

            // --- 5. Commit the Transaction ---
            await trx.commit();
            logger.info({ storeId }, "Committed bank details and OAuth state to DB successfully.");

            // --- 6. Get Config from Environment Variables ---
            const clientId = process.env.RAZORPAY_CLIENT_ID;
            const redirectUri = process.env.RAZORPAY_REDIRECT_URI;
            const scopes = process.env.RAZORPAY_SCOPES;

            if (!clientId || !redirectUri || !scopes) {
                logger.error('Razorpay OAuth environment variables missing (CLIENT_ID, REDIRECT_URI, SCOPES).');
                return reply.status(500).send({ error: 'Server configuration error.' });
            }

            // --- 7. Prepare and Return Response Payload for Frontend ---
            const responsePayload = {
                authorizationEndpoint: RAZORPAY_AUTHORIZATION_ENDPOINT,
                clientId: clientId,
                scopes: scopes,
                state: state,
                redirectUri: redirectUri
            };
            logger.info({ clientId, state: state.substring(0, 5) + '...' }, 'Returning OAuth parameters to frontend.');
            return reply.send(responsePayload);

        } catch (error) {
            // Rollback transaction on any error
            if (trx && !trx.isCompleted()) {
                await trx.rollback();
            }
            logger.error({ err: error, storeId, merchantId }, 'Unexpected error during OAuth initiation.');
            // Send a more generic error message to the client
            return reply.status(500).send({ error: error.message === "Server encryption configuration error." ? error.message : 'An unexpected server error occurred.' });
        }
    });
};