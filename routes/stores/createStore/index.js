'use strict'

const knex = require("@database/knexInstance"); // Assuming this is your Knex instance path
const { v4: uuidv4 } = require('uuid');

// It's a good practice to have your Razorpay category data available for validation
// For example, import it if you have it in a shared constants file:
// const { business_types, categories } = require('../../shared/constants/razorpayData');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const {
            storeId,
            storeName,
            storeHandle,
            storeDescription,
            storeTags,
            storeSettings, // Contains defaultGstRate, defaultGstInclusive
            legalBusinessName,
            storeEmail,
            storePhone,
            businessType,
            category,
            subCategory, // Can be null or empty string
            registeredAddress,
            isPlatformOwned
        } = request.body;
        const merchantId = request.user.merchantId; // From token payload

        // --- Basic Validation ---
        if (!storeId || !storeName || !storeHandle || !storeDescription || !storeSettings ||
            !legalBusinessName || !storeEmail || !storePhone || !businessType || !category || !registeredAddress) {
            // Note: subCategory is not checked here as it can be optional
            // registeredAddress being an empty object {} might pass; ensure frontend sends valid structure or null
            return reply.status(400).send({ error: 'Missing required store or business detail fields' });
        }

        if (typeof registeredAddress !== 'object' || registeredAddress === null || Object.keys(registeredAddress).length === 0) {
            return reply.status(400).send({ error: 'Registered address must be a valid object with address details.' });
        }
        // Add more specific validation for address fields if needed, e.g., address.street1

        const { defaultGstRate, defaultGstInclusive } = storeSettings;
        if (defaultGstRate === undefined || defaultGstRate === null || defaultGstInclusive === undefined) {
            return reply.status(400).send({ error: 'Missing or invalid GST settings (defaultGstRate, defaultGstInclusive)' });
        }

        // TODO: Advanced Validation (Recommended)
        // - Validate storeEmail format (e.g., using a regex or library)
        // - Validate storePhone format
        // - Validate businessType, category, subCategory against your predefined lists
        //   (e.g., from the razorpayData.js file if shared with the backend)
        //   Example check: if (!business_types.includes(businessType)) { /* error */ }
        //   Example check: if (!razorpayCategoriesData[category]) { /* error */ }
        //   Example check: if (subCategory && razorpayCategoriesData[category] && !razorpayCategoriesData[category].subcategories.includes(subCategory)) { /* error */ }


        try {
            // --- Check Merchant Permission to create Platform Stores ---
            const merchant = await knex('merchants')
                .select('isPlatformMerchant')
                .where('merchantId', merchantId)
                .first();

            if (!merchant) {
                logger.error({ merchantId }, "Authenticated merchantId not found in merchants table.");
                return reply.status(403).send({ error: 'Forbidden: Invalid merchant account.' });
            }

            const canCreatePlatformStore = merchant.isPlatformMerchant;
            let finalIsPlatformOwned = false;
            if (canCreatePlatformStore && isPlatformOwned === true) {
                finalIsPlatformOwned = true;
            } else if (!canCreatePlatformStore && isPlatformOwned === true) {
                logger.warn({ merchantId, requestedIsPlatformOwned: true }, "Non-platform merchant attempted to create a platform-owned store. Forcing ownership to false.");
            }
            logger.info({ merchantId, storeId, finalIsPlatformOwned }, "Determined final isPlatformOwned status for new store.");

            // --- Check if storeId or storeHandle already exists ---
            const existingStore = await knex('stores')
                .where('storeId', storeId)
                .orWhere('storeHandle', storeHandle)
                .first();

            if (existingStore) {
                if (existingStore.storeId === storeId) {
                    return reply.status(409).send({ error: `Store with ID ${storeId} already exists` }); // 409 Conflict
                }
                if (existingStore.storeHandle === storeHandle) {
                    return reply.status(409).send({ error: `Store with handle @${storeHandle} already exists` }); // 409 Conflict
                }
            }

            const store = await knex.transaction(async (trx) => {
                // Insert into stores
                const [createdStore] = await trx('stores')
                    .insert({
                        storeId,
                        storeName,
                        storeHandle,
                        storeDescription,
                        storeLogoImage: null, // Assuming logo is handled separately
                        storeTags: JSON.stringify(storeTags || []), // Ensure it's a JSON string
                        isActive: false, // New stores are inactive by default
                        isPlatformOwned: finalIsPlatformOwned,
                        // New fields
                        legalBusinessName,
                        storeEmail,
                        storePhone,
                        businessType,
                        category,
                        subCategory: subCategory || null, // Store null if empty/undefined
                        registeredAddress, // Knex handles JSONB object stringification
                        // timestamps are handled by `table.timestamps(true, true);` if defaults are used
                        // If you want to explicitly set them:
                        // created_at: knex.fn.now(),
                        // updated_at: knex.fn.now()
                    })
                    .returning('*'); // Return all columns of the created store

                // Insert into merchantStores (Admin)
                await trx('merchantStores')
                    .insert({
                        merchantStoreId: uuidv4(),
                        merchantId,
                        storeId, // Use the storeId from the request body (which should be the PK)
                        merchantRole: 'Admin',
                        canReceiveMessages: true,
                        // created_at: knex.fn.now(), // if not handled by DB default or Knex default
                    });

                // Insert default GST settings into storeSettings table
                await trx('storeSettings')
                    .insert({
                        storeId, // Use the storeId from the request body
                        defaultGstRate,
                        defaultGstInclusive,
                        // created_at: knex.fn.now(), // if not handled by DB default or Knex default
                    });

                // Insert default merchant notification preferences
                await trx('merchantNotificationPreferences')
                    .insert({
                        merchantId,
                        storeId, // Use the storeId from the request body
                        muteAll: false,
                        newOrders: true,
                        chatMessages: true,
                        returnRequests: true,
                        orderCancellations: true,
                        miscellaneous: true,
                        ratingsAndReviews: true,
                        newFollowers: true,
                        // created_at: knex.fn.now(), // if not handled by DB default or Knex default
                        // updated_at: knex.fn.now(), // if not handled by DB default or Knex default
                    });

                return createdStore;
            });

            logger.info({ storeId: store.storeId, merchantId }, "Store created successfully");
            return reply.status(201).send({ store }); // 201 Created status
        } catch(err) {
            logger.error({ err, body: request.body }, 'Error creating store');
            // Check for specific Knex errors, like unique constraint violations if not caught above
            if (err.routine === '_bt_check_unique') { // Example for PostgreSQL unique violation
                return reply.status(409).send({ error: 'A store with similar unique details already exists.' });
            }
            return reply.status(500).send({ error: 'Failed to create store due to an internal error.' });
        }
    });
}