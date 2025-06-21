'use strict';

const knex = require('@database/knexInstance');
const axios = require('axios');
const { decryptText } = require('../../../../utils/encryption');

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v2';
const API_TIMEOUT = 7000;

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        // Use storeId from query params for context, and merchantId from the auth token
        const { storeId } = request.query;
        const { merchantId } = request.user;
        const logger = fastify.log;

        // 1. Initial Validation
        if (!merchantId) {
            return reply.status(401).send({ error: 'Authentication failed: Merchant ID missing.' });
        }
        if (!storeId) {
            return reply.status(400).send({ error: 'A storeId query parameter is required.' });
        }

        try {
            // 2. Authorization Check: Verify the current user is an 'Owner' of the store they are querying.
            const storeAccess = await knex('merchantStores')
                .where({ storeId, merchantId, merchantRole: 'Owner' })
                .first('merchantStoreId');

            if (!storeAccess) {
                return reply.status(403).send({ error: 'Forbidden: Only the store owner can manage payment settings.' });
            }

            // 3. The "Store-First" Check: See if the store is already linked to ANY credential set.
            const linkRecord = await knex('store_razorpay_links as srl')
                .join('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .join('merchants as m', 'rc.addedByMerchantId', 'm.merchantId')
                .where('srl.storeId', storeId)
                .select(
                    'rc.addedByMerchantId',
                    'rc.razorpayLinkedAccountId',
                    'rc.setupStatus',
                    'm.fullName as linkedMerchantName'
                )
                .first();

            // 4. Handle Case A: The store IS already linked to a payment profile.
            if (linkRecord) {
                const isLinkedToCurrentUser = linkRecord.addedByMerchantId === merchantId;
                const isFinancialProfileLocked = linkRecord.setupStatus === 'complete';

                // Case A.1: Linked to the CURRENT user viewing the page.
                if (isLinkedToCurrentUser) {
                    logger.info({ merchantId, storeId }, "Store is linked to the current merchant. Fetching live details.");

                    let liveDetails = { name: null, email: null, status: null, error: null };
                    if (linkRecord.razorpayLinkedAccountId) {
                        try {
                            const keyId = process.env.RAZORPAY_KEY_ID;
                            const keySecret = process.env.RAZORPAY_KEY_SECRET;
                            const basicAuthToken = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
                            const accountApiUrl = `${RAZORPAY_API_BASE}/accounts/${linkRecord.razorpayLinkedAccountId}`;

                            const razorpayResponse = await axios.get(accountApiUrl, {
                                headers: { 'Authorization': `Basic ${basicAuthToken}` },
                                timeout: API_TIMEOUT
                            });

                            liveDetails.name = razorpayResponse.data?.legal_business_name || razorpayResponse.data?.contact_name;
                            liveDetails.email = razorpayResponse.data?.email;
                            liveDetails.status = razorpayResponse.data?.status;
                        } catch (razorpayError) {
                            liveDetails.error = razorpayError.response?.data?.error?.description || 'Could not fetch live details from Razorpay.';
                            logger.error({ err: razorpayError, accountId: linkRecord.razorpayLinkedAccountId }, "Failed to fetch live Razorpay account details.");
                        }
                    }

                    return reply.send({
                        status: 'LINKED',
                        setupStatus: linkRecord.setupStatus,
                        isFinancialProfileLocked,
                        linkedAccountId: linkRecord.razorpayLinkedAccountId,
                        liveDetails,
                    });
                }
                // Case A.2: Linked to a DIFFERENT owner.
                else {
                    logger.info({ merchantId, storeId }, "Store is linked, but by another merchant.");
                    return reply.send({
                        status: 'LINKED_BY_OTHER',
                        isFinancialProfileLocked,
                        linkedOwnerName: linkRecord.linkedMerchantName
                    });
                }
            }

            // 5. Handle Case B: The store is NOT linked. Check the merchant's own status.
            const myCredentialRecord = await knex('razorpay_credentials').where({ addedByMerchantId: merchantId }).first();

            if (myCredentialRecord) {
                // Case B.1: Merchant is onboarded but this store is not linked.
                logger.info({ merchantId, storeId }, 'Merchant is onboarded, but this store is not linked.');
                return reply.send({
                    status: 'ONBOARDED_NOT_LINKED',
                    isFinancialProfileLocked: myCredentialRecord.setupStatus === 'complete'
                });
            } else {
                // Case B.2: Merchant has never been onboarded.
                logger.info({ merchantId }, 'Merchant has not been onboarded with Razorpay yet.');

                const merchantProfile = await knex('merchants').where({ merchantId }).first();
                const financialProfile = await knex('merchant_financials').where({ merchantId }).first();

                const prefillData = {
                    legalBusinessName: merchantProfile?.legalBusinessName || '',
                    businessType: merchantProfile?.businessType || '',
                    registeredAddress: merchantProfile?.registeredAddress || {},
                    bankDetails: financialProfile ? {
                        beneficiary_name: decryptText(financialProfile.beneficiaryName_encrypted),
                        account_number: decryptText(financialProfile.accountNumber_encrypted),
                        ifsc_code: decryptText(financialProfile.ifscCode_encrypted),
                    } : {},
                    stakeholderDetails: financialProfile ? {
                        name: decryptText(financialProfile.stakeholder_name_encrypted),
                        email: decryptText(financialProfile.stakeholder_email_encrypted),
                        pan: decryptText(financialProfile.stakeholder_pan_encrypted),
                    } : {}
                };

                return reply.send({
                    status: 'NOT_ONBOARDED',
                    isFinancialProfileLocked: false,
                    prefillData: prefillData
                });
            }
        } catch (dbError) {
            logger.error({ err: dbError, storeId, merchantId }, 'Error during payment setup status check.');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};