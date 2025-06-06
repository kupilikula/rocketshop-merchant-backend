// routes/razorpay/exchangeCodeForTokens.js

'use strict';

const knex = require('@database/knexInstance'); // Adjust path to your Knex instance
const axios = require('axios');
const { encryptText, decryptText } = require("../../../utils/encryption"); // Adjust path and function names as needed

/**
 * Helper function to update the setup status for a given credential record.
 * @param {object} logger - The Fastify logger instance.
 * @param {string} razorpayAffiliateAccountId - The ID to find the record.
 * @param {string} status - The new status to set.
 */
const updateSetupStatus = async (logger, razorpayAffiliateAccountId, status) => {
    try {
        await knex('razorpay_credentials')
            .where({ razorpayAffiliateAccountId })
            .update({ setupStatus: status, updated_at: new Date() });
        logger.info({ razorpayAffiliateAccountId, newStatus: status }, "Updated Razorpay setup status.");
    } catch (error) {
        logger.error({ err: error, razorpayAffiliateAccountId, status }, "Failed to update setup status in DB.");
        // Non-fatal, as the primary operation might have succeeded. Log and monitor.
    }
};

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
        let razorpayAffiliateAccountId;
        let credentialId;

        try {
            // --- Steps 1-5: Atomic OAuth Data Processing ---
            const stateRecord = await knexTx('razorpay_oauth_states').where('state', receivedState).first();

            if (!stateRecord || new Date(stateRecord.expires_at) < new Date() || stateRecord.storeId !== storeId) {
                await knexTx.rollback();
                return reply.status(400).send({ success: false, error: 'Invalid or expired state parameter. Please try again.' });
            }
            const targetStoreId = stateRecord.storeId;
            await knexTx('razorpay_oauth_states').where({ id: stateRecord.id }).del();

            const tokenResponse = await axios.post('https://auth.razorpay.com/token', {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.RAZORPAY_REDIRECT_URI,
                client_id: process.env.RAZORPAY_CLIENT_ID,
                client_secret: process.env.RAZORPAY_CLIENT_SECRET,
            }, { headers: { 'Content-Type': 'application/json' } });

            const tokenData = tokenResponse.data;
            razorpayAffiliateAccountId = tokenData.razorpay_account_id;
            if (!razorpayAffiliateAccountId || !tokenData.access_token) {
                throw new Error("Token response from Razorpay was missing required account_id or access_token.");
            }

            const credentialData = {
                razorpayAffiliateAccountId,
                public_token: encryptText(tokenData.public_token),
                accessToken: encryptText(tokenData.access_token),
                refreshToken: tokenData.refresh_token ? encryptText(tokenData.refresh_token) : null,
                tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)) : null,
                grantedScopes: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : tokenData.scope,
                addedByMerchantId: initiatingMerchantId,
                setupStatus: 'oauth_complete' // Initial status after successful OAuth
            };

            const result = await knexTx('razorpay_credentials')
                .insert(credentialData)
                .onConflict('razorpayAffiliateAccountId')
                .merge()
                .returning('credentialId');

            credentialId = result[0]?.credentialId || (await knexTx('razorpay_credentials').where({ razorpayAffiliateAccountId }).first('credentialId'))?.credentialId;

            if (!credentialId) {
                throw new Error("Failed to find or create credential record after upsert.");
            }

            await knexTx('store_razorpay_links')
                .insert({ storeId: targetStoreId, razorpayCredentialId: credentialId })
                .onConflict('storeId')
                .merge({ razorpayCredentialId: credentialId, updated_at: new Date() });

            // --- Step 6: Commit Transaction ---
            await knexTx.commit();
            logger.info({ razorpayAffiliateAccountId }, `Transaction committed. Starting post-OAuth setup.`);

        } catch (error) {
            if (knexTx && !knexTx.isCompleted()) await knexTx.rollback();
            logger.error({ err: error }, 'Error during primary OAuth transaction.');
            return reply.status(500).send({ success: false, error: 'An error occurred during account connection.' });
        }

// ----- Post-Transaction Setup: All subsequent steps are handled outside the transaction -----
        // If any of these fail, we log, update the status, but still return success for the OAuth part.

        const platformRazorpayKeyId = process.env.RAZORPAY_KEY_ID;
        const platformRazorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
        const basicAuthToken = Buffer.from(`${platformRazorpayKeyId}:${platformRazorpayKeySecret}`).toString('base64');
        const headers = { 'Authorization': `Basic ${basicAuthToken}`, 'Content-Type': 'application/json' };

        // --- CORRECTED: Variables declared outside the try block to be accessible in catch ---
        let newRazorpayRouteAccountId = null;
        let productConfigId = null;
        let failedStep = 0; // 0 indicates no post-transaction step has started

        try {
            // --- Step 7: Create Razorpay Route Account ---
            failedStep = 7;
            const storeProfile = await knex('stores').where({ storeId }).first();
            if (!storeProfile) throw new Error(`Store profile not found for storeId ${storeId}`);

            const routeAccountPayload = {
                email: storeProfile.storeEmail, phone: storeProfile.storePhone,
                legal_business_name: storeProfile.legalBusinessName, customer_facing_business_name: storeProfile.storeName,
                type: "route", business_type: storeProfile.businessType,
                profile: {
                    category: storeProfile.category, subcategory: storeProfile.subcategory,
                    addresses: { registered: {
                            street1: storeProfile.registeredAddress.street1, street2: storeProfile.registeredAddress.street2,
                            city: storeProfile.registeredAddress.city, state: storeProfile.registeredAddress.state,
                            country: "IN", postal_code: storeProfile.registeredAddress.postalCode
                        }}
                }
            };
            const routeAccountResponse = await axios.post('https://api.razorpay.com/v2/accounts', routeAccountPayload, { headers });
            newRazorpayRouteAccountId = routeAccountResponse.data.id;

            await knex('razorpay_credentials').where({ razorpayAffiliateAccountId }).update({ razorpayLinkedAccountId: newRazorpayRouteAccountId });
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'route_account_created');

            // --- Step 8: Create Stakeholder ---
            failedStep = 8;
            const profileRecord = await knex('store_bank_accounts').where({ storeId }).first();
            if (!profileRecord) throw new Error(`Stakeholder/Bank details not found for store ${storeId}`);

            const stakeholderPayload = {
                name: decryptText(profileRecord.stakeholder_name_encrypted),
                email: decryptText(profileRecord.stakeholder_email_encrypted),
                kyc: { pan: decryptText(profileRecord.stakeholder_pan_encrypted) },
            };
            if (!stakeholderPayload.name || !stakeholderPayload.email || !stakeholderPayload.kyc.pan) throw new Error(`Decryption failed for stakeholder details of store ${storeId}`);

            await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/stakeholders`, stakeholderPayload, { headers });
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'stakeholder_created');

            // --- Step 9: Request Product Configuration ---
            failedStep = 9;
            const productConfigPayload = { product_name: "route", tnc_accepted: true };
            const productConfigResponse = await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products`, productConfigPayload, { headers });
            productConfigId = productConfigResponse.data.id;
            await knex('razorpay_credentials').where({ razorpayAffiliateAccountId }).update({ razorpayProductConfigId: productConfigId });
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'product_requested');

            // --- Step 10: Update Product Configuration with Bank Details ---
            failedStep = 10;
            const productUpdatePayload = {
                settlements: {
                    account_number: decryptText(profileRecord.accountNumber_encrypted),
                    ifsc_code: decryptText(profileRecord.ifscCode_encrypted),
                    beneficiary_name: decryptText(profileRecord.beneficiaryName_encrypted),
                },
                tnc_accepted: true
            };
            if (!productUpdatePayload.settlements.account_number || !productUpdatePayload.settlements.ifsc_code || !productUpdatePayload.settlements.beneficiary_name) {
                throw new Error(`Decryption failed for bank details of store ${storeId}`);
            }
            await axios.patch(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products/${productConfigId}`, productUpdatePayload, { headers });
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'complete');

            logger.info({ razorpayAffiliateAccountId }, "Full Razorpay Route setup completed successfully.");

        } catch (setupError) {
            const statusUpdateMap = {
                7: 'route_account_failed', 8: 'stakeholder_creation_failed',
                9: 'product_request_failed', 10: 'product_update_failed',
            };
            // Now this logic will work correctly
            if (razorpayAffiliateAccountId && failedStep > 0) {
                await updateSetupStatus(logger, razorpayAffiliateAccountId, statusUpdateMap[failedStep]);
            }
            // Corrected typo from `failedAtStep` to `failedStep`
            logger.error({ err: setupError.response?.data || setupError.message, failedStep }, "A failure occurred during post-OAuth setup.");
        }

        // --- Final Reply to Frontend ---
        // We always return success here because the primary OAuth connection was successful.
        // The frontend should use the /status endpoint to check the detailed setupStatus.
        return reply.send({ success: true, message: 'Razorpay account connected. Finalizing setup.' });
    });
};