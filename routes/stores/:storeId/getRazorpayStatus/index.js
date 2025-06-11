// src/routes/stores/razorpayConnectionStatus.js

'use strict';

const knex = require('@database/knexInstance');
const axios = require('axios');
const { decryptText } = require("../../../../utils/encryption");

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v2';
const API_TIMEOUT = 7000;

module.exports = async function (fastify, opts) {
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { storeId } = request.params;
        const merchantId = request.user?.merchantId;
        const logger = fastify.log;

        if (!merchantId) {
            return reply.status(403).send({ error: 'Forbidden: Authentication required.' });
        }

        try {
            const storeAccess = await knex('merchantStores')
                .where({ storeId: storeId, merchantId: merchantId })
                .first('merchantStoreId');

            if (!storeAccess) {
                return reply.status(403).send({ error: 'Forbidden: Access denied to this store.' });
            }

            // --- Step 2: ALWAYS fetch locally saved profile data ---
            logger.info({ storeId }, "Fetching locally saved bank/stakeholder details...");
            let decryptedBankDetails = null;
            let decryptedStakeholderDetails = null;

            const profileRecord = await knex('store_bank_accounts')
                .where('storeId', storeId)
                .first(
                    'accountNumber_encrypted',
                    'ifscCode_encrypted',
                    'beneficiaryName_encrypted',
                    'stakeholder_name_encrypted',
                    'stakeholder_email_encrypted',
                    'stakeholder_pan_encrypted'
                );

            if (profileRecord) {
                logger.info({ storeId }, "Found saved profile record. Decrypting...");
                decryptedBankDetails = {
                    account_number: decryptText(profileRecord.accountNumber_encrypted),
                    ifsc_code: decryptText(profileRecord.ifscCode_encrypted),
                    beneficiary_name: decryptText(profileRecord.beneficiaryName_encrypted)
                };
                decryptedStakeholderDetails = {
                    name: decryptText(profileRecord.stakeholder_name_encrypted),
                    email: decryptText(profileRecord.stakeholder_email_encrypted),
                    pan: decryptText(profileRecord.stakeholder_pan_encrypted)
                };
                // Check for a wholesale decryption failure (e.g., wrong key)
                if (Object.values(decryptedBankDetails).some(v => v === undefined) || Object.values(decryptedStakeholderDetails).some(v => v === undefined)) {
                    logger.error({ storeId }, "Decryption of profile details failed.");
                    return reply.status(500).send({ error: 'Server could not decrypt saved profile details.' });
                }
            } else {
                logger.info({ storeId }, "No saved profile record found.");
            }

            // --- Step 3: Check for an active link to determine connection status ---
            const linkAndStatus = await knex('stores as s')
                .innerJoin('store_razorpay_links as srl', 's.storeId', 'srl.storeId')
                .innerJoin('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .select('rc.razorpayLinkedAccountId', 'rc.setupStatus', 'rc.public_token as encryptedPublicToken')
                .where('s.storeId', storeId)
                .first();

            // --- Path A: Store is NOT fully connected via OAuth ---
            if (!linkAndStatus || !linkAndStatus.razorpayLinkedAccountId) {
                logger.info({ storeId }, 'No active Razorpay link found.');
                return reply.send({
                    isConnected: false,
                    setupStatus: 'not_connected',
                    bankDetails: decryptedBankDetails,
                    stakeholderDetails: decryptedStakeholderDetails,
                    // All other fields are null
                    linkedAccountId: null, name: null, email: null, status: null, error: null, publicToken: null
                });
            }

            // --- Path B: Store IS connected via OAuth. Return its status AND the profile data. ---
            const { razorpayLinkedAccountId, setupStatus, encryptedPublicToken } = linkAndStatus;
            const publicToken = decryptText(encryptedPublicToken);
            if (!publicToken) {
                return reply.status(500).send({ error: "Server credential configuration error." });
            }

            let accountName = null, accountEmail = null, liveRazorpayStatus = null, detailError = null;
            try {
                // Fetch live details from Razorpay API
                const keyId = process.env.RAZORPAY_KEY_ID_PLATFORM;
                const keySecret = process.env.RAZORPAY_KEY_SECRET_PLATFORM;
                const basicAuthToken = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
                const accountApiUrl = `${RAZORPAY_API_BASE}/accounts/${razorpayLinkedAccountId}`;

                const razorpayResponse = await axios.get(accountApiUrl, {
                    headers: { 'Authorization': `Basic ${basicAuthToken}`, 'Content-Type': 'application/json' },
                    timeout: API_TIMEOUT
                });

                const accountData = razorpayResponse.data;
                accountName = accountData?.legal_business_name || accountData?.contact_name || null;
                accountEmail = accountData?.email || null;
                liveRazorpayStatus = accountData?.status || null;
            } catch (razorpayError) {
                detailError = razorpayError.response?.data?.error?.description || 'Could not fetch live details from Razorpay.';
            }

            // Return the final combined status for a connected account
            return reply.send({
                isConnected: true,
                setupStatus: setupStatus,
                publicToken: publicToken,
                linkedAccountId: razorpayLinkedAccountId,
                name: accountName,
                email: accountEmail,
                status: liveRazorpayStatus,
                error: detailError,
                // Now include the locally stored details for pre-filling forms, even when connected
                bankDetails: decryptedBankDetails,
                stakeholderDetails: decryptedStakeholderDetails
            });

        } catch (dbError) {
            logger.error({ err: dbError, storeId, merchantId }, 'Error during razorpay connection status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};