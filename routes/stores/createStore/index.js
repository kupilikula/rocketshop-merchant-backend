'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const { storeId, storeName, storeHandle, storeDescription, storeTags, storeSettings, isPlatformOwned } = request.body;
        const merchantId = request.user.merchantId; // From token payload

        if (!storeName || !storeHandle || !storeDescription || !storeSettings) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        const { defaultGstRate, defaultGstInclusive } = storeSettings;
        if (defaultGstRate === undefined || defaultGstInclusive === undefined) {
            return reply.status(400).send({ error: 'Missing GST settings' });
        }

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
            logger.info({ merchantId, canCreatePlatformStore }, "Checked merchant platform store permission.");

            // Determine the actual ownership value based on permission and request
            let finalIsPlatformOwned = false; // Default to false
            if (canCreatePlatformStore && isPlatformOwned === true) {
                // Allow platform ownership ONLY if requested AND permitted
                finalIsPlatformOwned = true;
                logger.info({ merchantId, storeId }, "Platform merchant creating platform-owned store.");
            } else if (!canCreatePlatformStore && isPlatformOwned === true) {
                // If a non-platform merchant tries to set the flag, ignore it and log
                logger.warn({ merchantId, requestedIsPlatformOwned: true }, "Non-platform merchant attempted to create a platform-owned store. Forcing ownership to false.");
                // finalIsPlatformOwned remains false
            }
            // Otherwise, finalIsPlatformOwned remains false (either requested false or non-platform merchant)
            logger.info({ merchantId, storeId, finalIsPlatformOwned }, "Determined final isPlatformOwned status for new store.");


            // Check if storeId or storeHandle already exists
            const existingStore = await knex('stores')
                .where('storeId', storeId)
                .orWhere('storeHandle', storeHandle)
                .first();

            if (existingStore) {
                return reply.status(400).send({error: 'Store with this ID or Handle already exists'});
            }

            const store = await knex.transaction(async (trx) => {
                // Insert into stores
                const [createdStore] = await trx('stores')
                    .insert({
                        storeId,
                        storeName,
                        storeHandle,
                        storeDescription,
                        storeLogoImage: null,
                        storeTags: JSON.stringify(storeTags || []),
                        isActive: false,
                        isPlatformOwned: finalIsPlatformOwned,
                        created_at: knex.fn.now(),
                    })
                    .returning('*');

                // Insert into merchantStores (Admin)
                await trx('merchantStores')
                    .insert({
                        merchantStoreId: uuidv4(),
                        merchantId,
                        storeId,
                        merchantRole: 'Admin',
                        canReceiveMessages: true,
                        created_at: knex.fn.now(),
                    });

                // Insert default GST settings
                await trx('storeSettings')
                    .insert({
                        storeId,
                        defaultGstRate,
                        defaultGstInclusive,
                        created_at: knex.fn.now(),
                    });

                // Insert default merchant notification preferences
                await trx('merchantNotificationPreferences')
                    .insert({
                        merchantId,
                        storeId,
                        muteAll: false,
                        newOrders: true,
                        chatMessages: true,
                        returnRequests: true,
                        orderCancellations: true,
                        miscellaneous: true,
                        ratingsAndReviews: true,
                        newFollowers: true,
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now(),
                    });

                return createdStore;
            });

            return reply.status(200).send({
                store
            });
        } catch(err) {
          console.error('Error creating store:', err);
          return reply.status(500).send({ error: 'Failed to create store' });
        }
    });
}