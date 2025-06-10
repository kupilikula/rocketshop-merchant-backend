// src/routes/stores/razorpayConnectionStatus.js

'use strict';

const knex = require('@database/knexInstance');
const axios = require('axios');
const { decryptText } = require("../../../../utils/encryption");

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v2';
const API_TIMEOUT = 7000;

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
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

            const linkAndStatus = await knex('stores as s')
                .innerJoin('store_razorpay_links as srl', 's.storeId', 'srl.storeId')
                .innerJoin('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .select(
                    'rc.razorpayLinkedAccountId',
                    'rc.setupStatus',
                    'rc.public_token as encryptedPublicToken'
                )
                .where('s.storeId', storeId)
                .first();

            // If no link exists, check for saved bank/stakeholder details for pre-filling the form
            if (!linkAndStatus || !linkAndStatus.razorpayLinkedAccountId) {
                logger.info({ storeId }, 'No active Razorpay link found. Checking for saved bank/stakeholder details.');

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
                    logger.info({ storeId }, 'Found saved profile details for non-connected store.');

                    const decryptedBankDetails = {
                        account_number: decryptText(profileRecord.accountNumber_encrypted),
                        ifsc_code: decryptText(profileRecord.ifscCode_encrypted),
                        beneficiary_name: decryptText(profileRecord.beneficiaryName_encrypted)
                    };

                    const decryptedStakeholderDetails = {
                        name: decryptText(profileRecord.stakeholder_name_encrypted),
                        email: decryptText(profileRecord.stakeholder_email_encrypted),
                        pan: decryptText(profileRecord.stakeholder_pan_encrypted)
                    };

                    // Note: No need to check for decryption failure here, as an empty string is a valid pre-fill value
                    // which indicates to the user that the field is empty. The frontend form validation will enforce completion.

                    return reply.send({
                        isConnected: false,
                        setupStatus: 'not_connected',
                        bankDetails: decryptedBankDetails,
                        stakeholderDetails: decryptedStakeholderDetails, // <<< ADDED
                        linkedAccountId: null, name: null, email: null, status: null, error: null
                    });
                } else {
                    logger.info({ storeId }, 'No saved profile details found for non-connected store.');
                    return reply.send({
                        isConnected: false,
                        setupStatus: 'not_connected',
                        bankDetails: null,
                        stakeholderDetails: null, // <<< ADDED for consistent response shape
                        linkedAccountId: null, name: null, email: null, status: null, error: null
                    });
                }
            }

            // If linked locally, fetch live details from Razorpay
            const { razorpayLinkedAccountId, setupStatus, encryptedPublicToken } = linkAndStatus;

            const publicToken = decryptText(encryptedPublicToken);
            if (!publicToken) {
                logger.error({ storeId }, "Decryption of public_token failed. This will cause frontend checkout errors.");
                return reply.status(500).send({ error: "Server credential configuration error." });
            }

            const keyId = process.env.RAZORPAY_KEY_ID_PLATFORM;
            const keySecret = process.env.RAZORPAY_KEY_SECRET_PLATFORM;
            if (!keyId || !keySecret) { /* ... error handling ... */ }

            const basicAuthToken = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const accountApiUrl = `${RAZORPAY_API_BASE}/accounts/${razorpayLinkedAccountId}`;

            let accountName = null, accountEmail = null, liveRazorpayStatus = null, detailError = null;

            try {
                const razorpayResponse = await axios.get(accountApiUrl, { /* ... */ });
                // ... (logic to populate live details) ...
            } catch (razorpayError) {
                // ... (logic to populate detailError) ...
            }

            return reply.send({
                isConnected: true,
                setupStatus: setupStatus,
                publicToken: publicToken,
                linkedAccountId: razorpayLinkedAccountId,
                name: accountName,
                email: accountEmail,
                status: liveRazorpayStatus,
                error: detailError,
                bankDetails: null,
                stakeholderDetails: null, // <<< ADDED for consistent response shape
            });

        } catch (dbError) {
            logger.error({ err: dbError, storeId, merchantId }, 'Error during razorpay connection status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};