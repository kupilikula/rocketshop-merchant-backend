// routes/razorpay/exchangeCodeForTokens.js

'use strict';

const knex = require('@database/knexInstance'); // Adjust path to your Knex instance
const axios = require('axios');
const { encryptText, decryptText } = require("../../../utils/encryption"); // Adjust path and function names as needed

/**
 * Masks sensitive fields in a payload object for safe logging.
 * @param {object} payload - The request payload object.
 * @returns {object} A new object with sensitive fields masked.
 */
const maskSensitiveData = (payload) => {
    try {
        const masked = JSON.parse(JSON.stringify(payload)); // Deep clone to avoid side effects
        if (masked?.email) masked.email = '***REDACTED***';
        if (masked?.phone) masked.phone = '***REDACTED***';
        if (masked?.legal_business_name) masked.legal_business_name = '***REDACTED***';
        if (masked?.kyc?.pan) masked.kyc.pan = '***REDACTED***';
        if (masked?.settlements) {
            if (masked.settlements.account_number) masked.settlements.account_number = '***REDACTED***';
            if (masked.settlements.beneficiary_name) masked.settlements.beneficiary_name = '***REDACTED***';
        }
        return masked;
    } catch (e) {
        return { error: "Failed to mask data for logging." };
    }
};

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
    }
};

module.exports = async function (fastify) {
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

            const tokenPayload = {
                grant_type: 'authorization_code', code,
                redirect_uri: process.env.RAZORPAY_REDIRECT_URI,
                client_id: process.env.RAZORPAY_CLIENT_ID,
                client_secret: process.env.RAZORPAY_CLIENT_SECRET,
            };
            logger.info({ payload: {...tokenPayload, client_secret: '***'} }, "Calling Razorpay Token Exchange API...");
            const tokenResponse = await axios.post('https://auth.razorpay.com/token', tokenPayload, { headers: { 'Content-Type': 'application/json' } });
            logger.info({ status: tokenResponse.status, data: tokenResponse.data }, "Received response from Token Exchange API.");

            const tokenData = tokenResponse.data;
            razorpayAffiliateAccountId = tokenData.razorpay_account_id;
            if (!razorpayAffiliateAccountId || !tokenData.access_token) throw new Error("Token response missing required fields.");

            // ... (rest of transaction logic: encrypting tokens, upserting credentials and links)
            const credentialData = {
                razorpayAffiliateAccountId, public_token: encryptText(tokenData.public_token), accessToken: encryptText(tokenData.access_token), refreshToken: tokenData.refresh_token ? encryptText(tokenData.refresh_token) : null, tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)) : null, grantedScopes: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : tokenData.scope, addedByMerchantId: initiatingMerchantId, setupStatus: 'oauth_complete'
            };
            const result = await knexTx('razorpay_credentials').insert(credentialData).onConflict('razorpayAffiliateAccountId').merge().returning('credentialId');
            credentialId = result[0]?.credentialId || (await knexTx('razorpay_credentials').where({ razorpayAffiliateAccountId }).first('credentialId'))?.credentialId;
            if (!credentialId) throw new Error("Failed to find or create credential record after upsert.");
            await knexTx('store_razorpay_links').insert({ storeId: targetStoreId, razorpayCredentialId: credentialId }).onConflict('storeId').merge({ razorpayCredentialId: credentialId, updated_at: new Date() });

            await knexTx.commit();
            logger.info({ razorpayAffiliateAccountId }, `Transaction committed. Starting post-OAuth setup.`);

        } catch (error) {
            if (knexTx && !knexTx.isCompleted()) await knexTx.rollback();
            logger.error({ err: error.response?.data || error.message }, 'Error during primary OAuth transaction.');
            return reply.status(500).send({ success: false, error: 'An error occurred during account connection.' });
        }

        const platformRazorpayKeyId = process.env.RAZORPAY_KEY_ID;
        const platformRazorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
        const basicAuthToken = Buffer.from(`${platformRazorpayKeyId}:${platformRazorpayKeySecret}`).toString('base64');
        const headers = { 'Authorization': `Basic ${basicAuthToken}`, 'Content-Type': 'application/json' };

        let newRazorpayRouteAccountId = null;
        let productConfigId = null;
        let failedStep = 0;

        try {
            // --- Step 7: Create Razorpay Route Account ---
            failedStep = 7;
            const storeProfile = await knex('stores').where({ storeId }).first();
            if (!storeProfile) throw new Error(`Store profile not found`);
            const routeAccountPayload = {
                email: storeProfile.storeEmail, phone: storeProfile.storePhone, legal_business_name: storeProfile.legalBusinessName, customer_facing_business_name: storeProfile.storeName, type: "route", business_type: storeProfile.businessType, profile: { category: storeProfile.category, subcategory: storeProfile.subcategory, addresses: { registered: { street1: storeProfile.registeredAddress.street1, street2: storeProfile.registeredAddress.street2, city: storeProfile.registeredAddress.city, state: storeProfile.registeredAddress.state, country: "IN", postal_code: storeProfile.registeredAddress.postalCode }}}
            };
            logger.info({ payload: maskSensitiveData(routeAccountPayload) }, "Calling 'Create Route Account' API...");
            const routeAccountResponse = await axios.post('https://api.razorpay.com/v2/accounts', routeAccountPayload, { headers });
            logger.info({ status: routeAccountResponse.status, data: routeAccountResponse.data }, "Received response from 'Create Route Account' API.");
            newRazorpayRouteAccountId = routeAccountResponse.data.id;
            await knex('razorpay_credentials').where({ razorpayAffiliateAccountId }).update({ razorpayLinkedAccountId: newRazorpayRouteAccountId });
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'route_account_created');

            // --- Step 8: Create Stakeholder ---
            failedStep = 8;
            const profileRecord = await knex('store_bank_accounts').where({ storeId }).first();
            if (!profileRecord) throw new Error(`Stakeholder/Bank details not found`);
            const stakeholderPayload = {
                name: decryptText(profileRecord.stakeholder_name_encrypted), email: decryptText(profileRecord.stakeholder_email_encrypted), kyc: { pan: decryptText(profileRecord.stakeholder_pan_encrypted) },
            };
            if (!stakeholderPayload.name || !stakeholderPayload.email || !stakeholderPayload.kyc.pan) throw new Error(`Decryption failed for stakeholder details`);
            logger.info({ payload: maskSensitiveData(stakeholderPayload) }, "Calling 'Create Stakeholder' API...");
            const stakeholderResponse = await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/stakeholders`, stakeholderPayload, { headers });
            logger.info({ status: stakeholderResponse.status, data: stakeholderResponse.data }, "Received response from 'Create Stakeholder' API.");
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'stakeholder_created');

            // --- Step 9: Request Product Configuration ---
            failedStep = 9;
            const productConfigPayload = { product_name: "route", tnc_accepted: true };
            logger.info({ payload: productConfigPayload }, "Calling 'Request Product Configuration' API...");
            const productConfigResponse = await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products`, productConfigPayload, { headers });
            logger.info({ status: productConfigResponse.status, data: productConfigResponse.data }, "Received response from 'Request Product Configuration' API.");
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
            if (!productUpdatePayload.settlements.account_number) throw new Error(`Decryption failed for bank details`);
            logger.info({ payload: maskSensitiveData(productUpdatePayload) }, "Calling 'Update Product Configuration' API...");
            const productUpdateResponse = await axios.patch(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products/${productConfigId}`, productUpdatePayload, { headers });
            logger.info({ status: productUpdateResponse.status, data: productUpdateResponse.data }, "Received response from 'Update Product Configuration' API.");
            await updateSetupStatus(logger, razorpayAffiliateAccountId, 'complete');

            logger.info({ razorpayAffiliateAccountId }, "Full Razorpay Route setup completed successfully.");

        } catch (setupError) {
            const statusUpdateMap = {
                7: 'route_account_failed', 8: 'stakeholder_creation_failed',
                9: 'product_request_failed', 10: 'product_update_failed',
            };
            if (razorpayAffiliateAccountId && failedStep > 0) {
                await updateSetupStatus(logger, razorpayAffiliateAccountId, statusUpdateMap[failedStep]);
            }
            logger.error({ err: setupError.response?.data || setupError.message, failedStep }, "A failure occurred during post-OAuth setup.");
        }

        return reply.send({ success: true, message: 'Razorpay account connected. Finalizing setup.' });
    });
};