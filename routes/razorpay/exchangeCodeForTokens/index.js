'use strict';

const knex = require('@database/knexInstance');
const axios = require('axios');
const { encryptText, decryptText } = require("../../../utils/encryption");

/**
 * Masks sensitive fields in a payload object for safe logging.
 */
const maskSensitiveData = (payload) => {
    try {
        const masked = JSON.parse(JSON.stringify(payload));
        if (masked?.email) masked.email = '***';
        if (masked?.phone) masked.phone = '***';
        if (masked?.legal_business_name) masked.legal_business_name = '***';
        if (masked?.kyc?.pan) masked.kyc.pan = '***';
        if (masked?.settlements) {
            if (masked.settlements.account_number) masked.settlements.account_number = '***';
            if (masked.settlements.beneficiary_name) masked.settlements.beneficiary_name = '***';
        }
        return masked;
    } catch (e) {
        return { error: "Failed to mask data for logging." };
    }
};

/**
 * Helper function to update the setup status for a given credential record.
 */
const updateSetupStatus = async (logger, affiliateAccountId, status) => {
    try {
        await knex('razorpay_credentials')
            .where({ razorpayAffiliateAccountId: affiliateAccountId })
            .update({ setupStatus: status, updated_at: new Date() });
        logger.info({ affiliateAccountId, newStatus: status }, "Updated Razorpay setup status.");
    } catch (error) {
        logger.error({ err: error, affiliateAccountId, status }, "Failed to update setup status in DB.");
    }
};

/**
 * Contains the entire post-OAuth setup logic (Steps 7-10).
 */
async function performRouteSetup(logger, affiliateAccountId, storeId) {
    let newRazorpayRouteAccountId = null;
    let productConfigId = null;
    let failedStep = 0;

    const platformKeyId = process.env.RAZORPAY_KEY_ID;
    const platformKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const basicAuthToken = Buffer.from(`${platformKeyId}:${platformKeySecret}`).toString('base64');
    const headers = { 'Authorization': `Basic ${basicAuthToken}`, 'Content-Type': 'application/json' };

    try {
        // --- Step 7: Find or Create Razorpay Route Account ---
        failedStep = 7;
        const existingCredential = await knex('razorpay_credentials')
            .where({ razorpayAffiliateAccountId: affiliateAccountId })
            .first('razorpayLinkedAccountId', 'razorpayProductConfigId', 'razorpayStakeholderId');

        if (existingCredential && existingCredential.razorpayLinkedAccountId) {
            newRazorpayRouteAccountId = existingCredential.razorpayLinkedAccountId;
            productConfigId = existingCredential.razorpayProductConfigId;
            logger.info({ newRazorpayRouteAccountId }, "Found existing Route Account. Reusing it.");
        } else {
            logger.info({ affiliateAccountId }, "No existing Route Account found. Creating new one.");
            const storeProfile = await knex('stores').where({ storeId }).first();
            if (!storeProfile) throw new Error(`Store profile not found`);
            const routeAccountPayload = {
                email: storeProfile.storeEmail, phone: storeProfile.storePhone, legal_business_name: storeProfile.legalBusinessName,
                customer_facing_business_name: storeProfile.storeName, type: "route", business_type: storeProfile.businessType,
                profile: { category: storeProfile.category, subcategory: storeProfile.subcategory, addresses: { registered: { street1: storeProfile.registeredAddress.street1, street2: storeProfile.registeredAddress.street2, city: storeProfile.registeredAddress.city, state: storeProfile.registeredAddress.state, country: "IN", postal_code: storeProfile.registeredAddress.postalCode }}}
            };
            const routeAccountResponse = await axios.post('https://api.razorpay.com/v2/accounts', routeAccountPayload, { headers });
            newRazorpayRouteAccountId = routeAccountResponse.data.id;
            await knex('razorpay_credentials').where({ razorpayAffiliateAccountId }).update({ razorpayLinkedAccountId: newRazorpayRouteAccountId });
        }
        await updateSetupStatus(logger, affiliateAccountId, 'route_account_created');

        logger.info({ newRazorpayRouteAccountId }, "Fetching live status of Route Account from Razorpay...");
        const accountDetailsResponse = await axios.get(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}`, { headers });
        const liveAccountStatus = accountDetailsResponse.data.status;
        logger.info({ newRazorpayRouteAccountId, liveAccountStatus }, "Received live account status.");

        if (liveAccountStatus === 'created') {
            logger.info({ newRazorpayRouteAccountId }, "Account is already activated on Razorpay. Marking local setup as complete.");
            await updateSetupStatus(logger, affiliateAccountId, 'complete');
            return; // End the setup process here.
        }

        // --- Step 8: Find, Create, or Update Stakeholder ---
        failedStep = 8;
        const profileRecord = await knex('store_bank_accounts').where({ storeId }).first();
        if (!profileRecord) throw new Error(`Stakeholder/Bank details not found`);
        const stakeholderPayload = {
            name: decryptText(profileRecord.stakeholder_name_encrypted),
            email: decryptText(profileRecord.stakeholder_email_encrypted),
            kyc: { pan: decryptText(profileRecord.stakeholder_pan_encrypted) },
        };
        if (!stakeholderPayload.name || !stakeholderPayload.email || !stakeholderPayload.kyc.pan) throw new Error(`Decryption failed for stakeholder details`);

        // Check if a stakeholder already exists on Razorpay
        const existingStakeholdersResponse = await axios.get(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/stakeholders`, { headers });
        const existingStakeholder = existingStakeholdersResponse.data.items[0];

        let stakeholderId;

        if (existingStakeholder) {
            // --- PATH A: Stakeholder exists, UPDATE it ---
            stakeholderId = existingStakeholder.id;
            logger.info({ stakeholderId }, "Found existing stakeholder. Updating details...");
            await axios.patch(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/stakeholders/${stakeholderId}`, stakeholderPayload, { headers });
        } else {
            // --- PATH B: No stakeholder exists, CREATE it ---
            logger.info({ newRazorpayRouteAccountId }, "No existing stakeholder found. Creating new one...");
            const stakeholderResponse = await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/stakeholders`, stakeholderPayload, { headers });
            stakeholderId = stakeholderResponse.data.id;
        }

        // Store the definitive stakeholder ID in our database
        await knex('razorpay_credentials').where({ razorpayAffiliateAccountId: affiliateAccountId }).update({ razorpayStakeholderId: stakeholderId });
        await updateSetupStatus(logger, affiliateAccountId, 'stakeholder_created');
        logger.info({ stakeholderId }, "Stakeholder setup step complete.");


        // --- Step 9: Request Product Configuration ---
        if (!productConfigId) {
            failedStep = 9;
            const productConfigPayload = { product_name: "route", tnc_accepted: true };
            const productConfigResponse = await axios.post(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products`, productConfigPayload, { headers });
            productConfigId = productConfigResponse.data.id;
            await knex('razorpay_credentials').where({ razorpayAffiliateAccountId }).update({ razorpayProductConfigId: productConfigId });
        }
        await updateSetupStatus(logger, affiliateAccountId, 'product_requested');
        logger.info({ productConfigId }, "Product configuration step complete.");

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

        await axios.patch(`https://api.razorpay.com/v2/accounts/${newRazorpayRouteAccountId}/products/${productConfigId}`, productUpdatePayload, { headers });
        await updateSetupStatus(logger, affiliateAccountId, 'complete');

        logger.info({ affiliateAccountId }, "Full Razorpay Route setup completed successfully.");

    } catch (setupError) {
        const statusUpdateMap = { 7: 'route_account_failed', 8: 'stakeholder_creation_failed', 9: 'product_request_failed', 10: 'product_update_failed' };
        if (affiliateAccountId && failedStep > 0) {
            await updateSetupStatus(logger, affiliateAccountId, statusUpdateMap[failedStep]);
        }
        logger.error({ err: setupError.response?.data || setupError.message, failedStep }, "A failure occurred during post-OAuth setup.");
    }
}

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
        try {
            // Steps 1-6: Atomic OAuth Data Processing
            const stateRecord = await knexTx('razorpay_oauth_states').where('state', receivedState).first();
            if (!stateRecord || new Date(stateRecord.expires_at) < new Date() || stateRecord.storeId !== storeId) {
                await knexTx.rollback();
                return reply.status(400).send({ success: false, error: 'Invalid or expired state parameter. Please try again.' });
            }
            await knexTx('razorpay_oauth_states').where({ id: stateRecord.id }).del();

            const tokenPayload = {
                grant_type: 'authorization_code', code, redirect_uri: process.env.RAZORPAY_REDIRECT_URI,
                client_id: process.env.RAZORPAY_CLIENT_ID, client_secret: process.env.RAZORPAY_CLIENT_SECRET,
            };
            const tokenResponse = await axios.post('https://auth.razorpay.com/token', tokenPayload, { headers: { 'Content-Type': 'application/json' }});
            const tokenData = tokenResponse.data;
            razorpayAffiliateAccountId = tokenData.razorpay_account_id;
            if (!razorpayAffiliateAccountId) throw new Error("Token response missing razorpay_account_id.");

            const credentialData = {
                razorpayAffiliateAccountId, public_token: encryptText(tokenData.public_token), accessToken: encryptText(tokenData.access_token),
                refreshToken: tokenData.refresh_token ? encryptText(tokenData.refresh_token) : null,
                tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)) : null,
                grantedScopes: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : tokenData.scope,
                addedByMerchantId: initiatingMerchantId, setupStatus: 'oauth_complete'
            };

            const result = await knexTx('razorpay_credentials').insert(credentialData).onConflict('razorpayAffiliateAccountId').merge().returning('credentialId');
            const credentialId = result[0]?.credentialId || (await knexTx('razorpay_credentials').where({ razorpayAffiliateAccountId }).first('credentialId'))?.credentialId;
            if (!credentialId) throw new Error("Failed to find or create credential record.");

            await knexTx('store_razorpay_links').insert({ storeId, razorpayCredentialId: credentialId }).onConflict('storeId').merge({ razorpayCredentialId: credentialId, updated_at: new Date() });

            await knexTx.commit();
            logger.info({ razorpayAffiliateAccountId }, `Transaction committed. Starting post-OAuth setup for store ${storeId}.`);

        } catch (error) {
            if (knexTx && !knexTx.isCompleted()) await knexTx.rollback();
            logger.error({ err: error.response?.data || error.message }, 'Error during primary OAuth transaction.');
            return reply.status(500).send({ success: false, error: 'An error occurred during account connection.' });
        }

        // Run the entire post-OAuth setup asynchronously without blocking the response.
        performRouteSetup(logger, razorpayAffiliateAccountId, storeId);

        // Immediately return success for the OAuth part.
        return reply.send({ success: true, message: 'Razorpay account connected. Finalizing setup in the background.' });
    });
};