// src/routes/stores/razorpayConnectionStatus.js (or your file path)

'use strict';

const knex = require('@database/knexInstance'); // <<< ADJUST path to your Knex instance
const axios = require('axios');
const { decryptText } = require("../../../utils/encryption"); // <<< Ensure path is correct

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v2';
const API_TIMEOUT = 7000;

module.exports = async function (fastify, opts) {
    // The route would be mounted under a prefix, e.g., GET /stores/:storeId/razorpay/status
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { storeId } = request.params;
        const merchantId = request.user?.merchantId;
        const logger = fastify.log;

        // 1. Authorization Check (unchanged)
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

            // 2. Check for Local Link and Get Razorpay Account ID & Setup Status
            logger.info({ storeId }, 'Checking local Razorpay link and setup status for store.');

            // --- QUERY MODIFIED to select setupStatus ---
            const linkAndStatus = await knex('stores as s')
                .innerJoin('store_razorpay_links as srl', 's.storeId', 'srl.storeId')
                .innerJoin('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .select(
                    'rc.razorpayLinkedAccountId', // The Route Account ID
                    'rc.setupStatus'              // The setup status field
                )
                .where('s.storeId', storeId)
                .first();

            // 3. If no link exists, check for saved bank details
            if (!linkAndStatus || !linkAndStatus.razorpayLinkedAccountId) {
                logger.info({ storeId }, 'No active Razorpay link found. Checking for saved bank details.');

                const bankDetailsRecord = await knex('store_bank_accounts').where('storeId', storeId).first();

                if (bankDetailsRecord) {
                    const decryptedDetails = {
                        account_number: decryptText(bankDetailsRecord.accountNumber_encrypted),
                        ifsc_code: decryptText(bankDetailsRecord.ifscCode_encrypted),
                        beneficiary_name: decryptText(bankDetailsRecord.beneficiaryName_encrypted),
                        // You could also decrypt and return stakeholder details here if needed for pre-filling
                    };

                    if (!decryptedDetails.account_number || !decryptedDetails.ifsc_code || !decryptedDetails.beneficiary_name) {
                        logger.error({ storeId }, "Decryption of bank details failed.");
                        return reply.status(500).send({ error: 'Server could not decrypt saved bank details.' });
                    }

                    return reply.send({
                        isConnected: false,
                        setupStatus: 'not_connected', // Explicit status for this state
                        bankDetails: decryptedDetails,
                        linkedAccountId: null, name: null, email: null, status: null, error: null
                    });
                } else {
                    return reply.send({
                        isConnected: false,
                        setupStatus: 'not_connected', // Explicit status
                        bankDetails: null,
                        linkedAccountId: null, name: null, email: null, status: null, error: null
                    });
                }
            }

            // 4. If linked locally, Fetch LIVE Details from Razorpay API
            const { razorpayLinkedAccountId, setupStatus } = linkAndStatus;
            logger.info({ storeId, razorpayLinkedAccountId, setupStatus }, 'Local link found. Fetching live details from Razorpay API...');

            // If setup is already complete, we can fetch live data.
            // If setup is NOT complete, we might not need to call Razorpay's API yet,
            // but for simplicity and to always get the latest live `status`, we will call it.
            const keyId = process.env.RAZORPAY_KEY_ID_PLATFORM;
            const keySecret = process.env.RAZORPAY_KEY_SECRET_PLATFORM;

            if (!keyId || !keySecret) {
                logger.error({ storeId, razorpayLinkedAccountId }, "Platform Razorpay API Keys are not configured on backend.");
                return reply.status(500).send({
                    isConnected: true, setupStatus, linkedAccountId: razorpayLinkedAccountId,
                    bankDetails: null, name: null, email: null, status: null,
                    error: 'Server configuration error prevented fetching live details.'
                });
            }

            const basicAuthToken = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const accountApiUrl = `${RAZORPAY_API_BASE}/accounts/${razorpayLinkedAccountId}`;

            let accountName = null, accountEmail = null, liveRazorpayStatus = null, detailError = null;

            try {
                const razorpayResponse = await axios.get(accountApiUrl, {
                    headers: { 'Authorization': `Basic ${basicAuthToken}`, 'Content-Type': 'application/json' },
                    timeout: API_TIMEOUT
                });
                const accountData = razorpayResponse.data;
                logger.info({ storeId, razorpayLinkedAccountId }, 'Successfully fetched details from Razorpay API.');
                accountName = accountData?.legal_business_name || accountData?.contact_name || null;
                accountEmail = accountData?.email || null;
                liveRazorpayStatus = accountData?.status || null; // e.g., 'created', 'activated', 'under_review'
            } catch (razorpayError) {
                const errorResponseData = razorpayError.response?.data?.error;
                logger.error({ err: errorResponseData || razorpayError.message, storeId, razorpayLinkedAccountId }, 'Error fetching details from Razorpay Account API.');
                detailError = errorResponseData?.description || 'Could not fetch live details from Razorpay.';
            }

            // 5. Return the final combined status for a connected account
            return reply.send({
                isConnected: true,
                setupStatus: setupStatus, // <<< The setupStatus from your DB
                linkedAccountId: razorpayLinkedAccountId,
                name: accountName,
                email: accountEmail,
                status: liveRazorpayStatus, // Live status from Razorpay API
                error: detailError,
                bankDetails: null
            });

        } catch (dbError) {
            logger.error({ err: dbError, storeId, merchantId }, 'Error during razorpay connection status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};