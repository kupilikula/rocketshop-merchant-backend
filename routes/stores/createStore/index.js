'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {

        const { storeId, storeName, storeHandle, storeDescription, storeTags, storeSettings } = request.body;
        const merchantId = request.user.merchantId; // From token payload

        if (!storeName || !storeHandle || !storeDescription || !storeSettings) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        const { defaultGstRate, defaultGstInclusive } = storeSettings;
        if (defaultGstRate === undefined || defaultGstInclusive === undefined) {
            return reply.status(400).send({ error: 'Missing GST settings' });
        }

        try {
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