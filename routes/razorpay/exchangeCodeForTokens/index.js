// routes/razorpay/exchangeCodeForTokens.js (Example path)

'use strict';

const knex = require('@database/knexInstance'); // Adjust path
const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); // For status history UUIDs if used elsewhere
const { encryptToken } = require("../../../utils/encryption"); // <<< ADJUST PATH

module.exports = async function (fastify) {
    fastify.post('/', async (request, reply) => {

        // Only need code and state from frontend
        const { code, state: receivedState } = request.body;
        // Get the merchantId who initiated the original request (for tracking, if desired)
        const initiatingMerchantId = request.user?.merchantId;

        if (!code || !receivedState) {
            return reply.status(400).send({ success: false, error: 'Missing required code or state parameter.' });
        }
        if (!initiatingMerchantId) {
            return reply.status(403).send({ success: false, error: 'Forbidden: Merchant not identified.' });
        }

        const knexTx = await knex.transaction(); // Start transaction

        try {
            // --- Step 1: Verify State & Get Associated Store ID ---
            fastify.log.info({ state: receivedState.substring(0,5)+'...' }, `Verifying state...`);
            const stateRecord = await knexTx('razorpay_oauth_states')
                .where('state', receivedState)
                .first('id', 'storeId', 'expires_at'); // Get storeId linked to state

            if (!stateRecord) {
                await knexTx.rollback();
                fastify.log.warn({ state: receivedState.substring(0,5)+'...' }, `Invalid or unknown state received.`);
                return reply.status(400).send({ success: false, error: 'Invalid state parameter. Session invalid or expired.' });
            }

            if (new Date(stateRecord.expires_at) < new Date()) {
                await knexTx('razorpay_oauth_states').where({ id: stateRecord.id }).del(); // Delete expired state
                await knexTx.commit(); // Commit the deletion
                fastify.log.warn({ state: receivedState.substring(0,5)+'...' }, `Expired state received.`);
                return reply.status(400).send({ success: false, error: 'OAuth session expired. Please try again.' });
            }

            const targetStoreId = stateRecord.storeId; // *** Get the target storeId from the state record ***
            fastify.log.info({ state: receivedState.substring(0,5)+'...', targetStoreId }, `State verified for store.`);

            // Delete the state immediately within the transaction
            await knexTx('razorpay_oauth_states').where({ id: stateRecord.id }).del();
            fastify.log.info({ state: receivedState.substring(0,5)+'...'}, `State deleted.`);

            // --- Step 2: Exchange Code for Tokens with Razorpay ---
            const clientId = process.env.RAZORPAY_CLIENT_ID;
            const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
            const redirectUri = process.env.RAZORPAY_REDIRECT_URI; // The backend callback URI registered with RZP

            if (!clientId || !clientSecret || !redirectUri) {
                await knexTx.rollback();
                fastify.log.error('Razorpay OAuth client credentials or redirect URI missing.');
                return reply.status(500).send({success: false, error: 'Server configuration error.'});
            }

            fastify.log.info(`Requesting tokens from Razorpay for code associated with state ${receivedState.substring(0,5)}...`);

                const tokenResponse = await axios.post('https://auth.razorpay.com/token', {
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri, // MUST match the URI registered AND used during initiation
                    client_id: clientId,
                    client_secret: clientSecret,
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    validateStatus: status => status < 500
                });
                console.log('DEBUG - Raw Token Response:', tokenResponse.data); // DEBUG only
            if (tokenResponse.status >= 400) {
                console.log('Token request failed, ', JSON.stringify(tokenResponse, null, 2));
                await knexTx.rollback();
                fastify.log.error({ statusCode: tokenResponse.status, responseData: tokenResponse.data }, 'Razorpay token exchange failed.');
                const errorMessage = tokenResponse.data?.error_description || tokenResponse.data?.error || 'Failed to exchange code with Razorpay.';
                return reply.status(400).send({success: false, error: errorMessage});
            }

            const tokenData = tokenResponse.data;
            fastify.log.info('Received successful token response from Razorpay:', Object.keys(tokenData));

            // --- Step 3: Extract Details & Encrypt Tokens ---
            const {
                access_token,
                refresh_token = null,
                expires_in = null,
                scope = null, // Check actual field name from Razorpay response
                razorpay_account_id
            } = tokenData;

            if (!razorpay_account_id || !access_token) { /* ... handle missing required fields, rollback ... */ }

            const encryptedAccessToken = encryptToken(access_token);
            const encryptedRefreshToken = refresh_token ? encryptToken(refresh_token) : null;
            const expiresAt = expires_in ? new Date(Date.now() + (expires_in * 1000)) : null;
            // Ensure scope is stored as text. If RZP returns array, join it.
            const grantedScopes = Array.isArray(scope) ? scope.join(' ') : scope;

            // --- Step 4: Find or Create Credential Record in `razorpay_credentials` ---
            let credentialId;
            const razorpayAccountId = razorpay_account_id; // Use consistent naming
            fastify.log.info({ razorpayAccountId }, "Checking/Updating razorpay_credentials record...");

            const credentialData = {
                razorpayAccountId: razorpayAccountId,
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                tokenExpiresAt: expiresAt,
                grantedScopes: grantedScopes,
                addedByMerchantId: initiatingMerchantId, // Track who linked it
                updated_at: new Date() // Explicitly set update time
            };

            // Try to insert, on conflict (unique razorpayAccountId), update instead (Upsert)
            const result = await knexTx('razorpay_credentials')
                .insert({ ...credentialData, credentialId: knex.raw('gen_random_uuid()') }) // Provide ID if needed
                .onConflict('razorpayAccountId') // Requires unique constraint on this column
                .merge({ // Columns to update on conflict
                    accessToken: encryptedAccessToken,
                    refreshToken: encryptedRefreshToken,
                    tokenExpiresAt: expiresAt,
                    grantedScopes: grantedScopes,
                    addedByMerchantId: initiatingMerchantId, // Update who last linked it? Optional.
                    updated_at: new Date()
                })
                .returning('credentialId'); // Get the ID whether inserted or updated

            if (!result || result.length === 0) {
                // Fetch separately if returning doesn't work on merge/update in all DB versions/configs
                const finalCredential = await knexTx('razorpay_credentials')
                    .where({ razorpayAccountId: razorpayAccountId })
                    .first('credentialId');
                if (!finalCredential) throw new Error('Failed to find or create credential record.');
                credentialId = finalCredential.credentialId;
            } else {
                credentialId = result[0].credentialId || result[0]; // Handle potential object vs value return
            }

            fastify.log.info({ credentialId, razorpayAccountId }, "Upserted razorpay_credentials record.");

            // --- Step 5: Link Store to Credential in `store_razorpay_links` ---
            fastify.log.info({ targetStoreId, credentialId }, "Linking store to razorpay credential using upsert...");

            await knexTx('store_razorpay_links')
                .insert({
                    // linkId: knex.raw('gen_random_uuid()'), // If UUID PK
                    storeId: targetStoreId, // The store this flow was initiated for
                    razorpayCredentialId: credentialId
                    // created_at/updated_at handled by timestamps()
                })
                .onConflict('storeId') // Based on unique constraint on storeId
                .merge({ // If link exists, update which credential it points to & timestamp
                    razorpayCredentialId: credentialId,
                    updated_at: new Date()
                });
            fastify.log.info(`Successfully linked store ${targetStoreId} to credential ${credentialId}.`);

            //
            // ***** NEW STEPS START HERE *****
            // --- Step 7: Create Razorpay Route Linked Account ---
            try {
                fastify.log.info({ targetStoreId, razorpayAccountId }, "Attempting to create Razorpay Route Linked Account...");

                const storeProfile = await knex('stores') // Use main knex instance (transaction committed)
                    .where('storeId', targetStoreId)
                    .select('storeName','storeEmail', 'legalBusinessName', 'storePhone', 'businessType', 'category', 'subcategory', 'registeredAddress')
                    .first();

                if (!storeProfile) {
                    fastify.log.error({ targetStoreId }, "Store profile not found after OAuth commit. Critical: Cannot create Route Linked Account.");
                    // Do not throw here to allow OAuth success message, but this is a problem.
                } else if (!storeProfile.storeEmail || !storeProfile.legalBusinessName || !storeProfile.businessType || !storeProfile.category || !storeProfile.registeredAddress) {
                    fastify.log.error({ targetStoreId, storeProfile }, "Store profile is missing mandatory fields for Route Linked Account creation. Critical: Cannot create Route Linked Account.");
                } else {
                    const linkedAccountPayload = {
                        email: storeProfile.storeEmail,
                        phone: storeProfile.storePhone,
                        legal_business_name: storeProfile.legalBusinessName,
                        customer_facing_business_name: storeProfile.storeName,
                        type: "route",
                        account_details: {
                            beneficiary_account_id: razorpayAccountId // Merchant's RZP account ID from OAuth
                        },
                        business_type: storeProfile.businessType,
                        profile: {
                            category: storeProfile.category,
                            subcategory: storeProfile.subcategory, // API allows optional
                            addresses: {
                                registered: {
                                    street1: storeProfile.registeredAddress.street1,
                                    street2: storeProfile.registeredAddress.street2 || undefined,
                                    city: storeProfile.registeredAddress.city,
                                    state: storeProfile.registeredAddress.state,
                                    // IMPORTANT: Razorpay often expects ISO 3166-1 alpha-2 country codes (e.g., "IN")
                                    // Your NewAddressForm stores full country names. You MAY need to convert this.
                                    country: storeProfile.registeredAddress.country.toLowerCase(), // Example: "India". Verify RZP requirement.
                                    postal_code: storeProfile.registeredAddress.postalCode
                                },
                            }
                        },
                    };

                    const platformRazorpayKeyId = process.env.RAZORPAY_KEY_ID;
                    const platformRazorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

                    if (!platformRazorpayKeyId || !platformRazorpayKeySecret) {
                        fastify.log.error("Platform's Razorpay API keys for Route (RAZORPAY_KEY_ID_PLATFORM, RAZORPAY_KEY_SECRET_PLATFORM) are not configured. Cannot create Route Linked Account.");
                    } else {
                        const routeApiUrl = `https://api.razorpay.com/v2/accounts`;
                        const basicAuthToken = Buffer.from(`${platformRazorpayKeyId}:${platformRazorpayKeySecret}`).toString('base64');

                        fastify.log.info({ targetStoreId, url: routeApiUrl }, "Calling Razorpay Create Linked Account API.");
                        try {
                            console.log('razorpay create linked account payload:', linkedAccountPayload);
                            const linkedAccountResponse = await axios.post(routeApiUrl, linkedAccountPayload, {
                                headers: {
                                    'Authorization': `Basic ${basicAuthToken}`,
                                    'Content-Type': 'application/json'
                                },
                                validateStatus: status => status < 500 // Handle 4xx as non-exceptions for detailed logging
                            });
                            console.log('razorpay create linked account response status:', linkedAccountResponse.status);
                            console.log('razorpay create linked account response :', JSON.stringify(linkedAccountResponse.data, null, 2));
                            if (linkedAccountResponse.status >= 200 && linkedAccountResponse.status < 300) {
                                const linkedAccountData = linkedAccountResponse.data;
                                const razorpayLinkedAccountId = linkedAccountData.id; // This is the 'la_...' ID
                                fastify.log.info({ targetStoreId, razorpayAccountId, razorpayLinkedAccountId }, "Razorpay Route Linked Account created successfully.");

                            } else {
                                fastify.log.error({
                                    targetStoreId,
                                    razorpayAccountIdForRoute: razorpayAccountId,
                                    statusCode: linkedAccountResponse.status,
                                    requestPayload: linkedAccountPayload, // Log payload for debugging
                                    responseData: linkedAccountResponse.data
                                }, "Failed to create Razorpay Route Linked Account. API returned error.");
                            }
                        } catch (routeApiError) { // Network error or non-4xx error from Axios
                            fastify.log.error({ err: routeApiError, targetStoreId, razorpayAccountIdForRoute: razorpayAccountId }, "Exception during Razorpay Route Linked Account API call.");
                        }
                    }
                }
            } catch (routeSetupError) {
                // This catches errors from fetching storeProfile or other logic within Step 7 block
                fastify.log.error({ err: routeSetupError, targetStoreId }, "Error during setup phase for creating Route Linked Account (after OAuth commit).");
            }
            // ***** NEW STEPS END HERE *****


            // --- Step 6: Commit Transaction ---
            await knexTx.commit();
            fastify.log.info(`Transaction committed for store ${targetStoreId} Razorpay link.`);

            // Create Route Linked Account and setup Route


            // --- Step End: Reply to Frontend ---
            return reply.send({ success: true, message: 'Razorpay account connected successfully.' });

        } catch (error) {
            // Rollback transaction on any error
            if (knexTx && !knexTx.isCompleted()) {
                await knexTx.rollback();
                fastify.log.warn('Transaction rolled back due to error during token exchange/storage.');
            }
            fastify.log.error({ err: error }, 'Error in /exchangeCodeForTokens route');

            // Handle specific DB errors if needed (check constraints on NEW tables)
            if (error.code === '23505') { // Postgres unique violation
                if (error.constraint && error.constraint.includes('razorpay_credentials_razorpayaccountid_unique')) {
                    return reply.status(500).send({ success: false, error: 'Internal Server Error (RZP ID Conflict).' }); // Should be handled by upsert
                }
                if (error.constraint && error.constraint.includes('store_razorpay_links_storeid_unique')) {
                    return reply.status(500).send({ success: false, error: 'Internal Server Error (Store Link Conflict).' });// Should be handled by upsert
                }
            }
            return reply.status(500).send({ success: false, error: error.message || 'An internal server error occurred.' });
        }
    });
};