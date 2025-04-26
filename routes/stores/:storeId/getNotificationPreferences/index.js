'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const merchantId = request.user.merchantId;
        const { storeId } = request.query;

        if (!storeId || !merchantId) {
            return reply.status(400).send({ error: 'storeId and merchantId is required' });
        }

        try {
            // Verify store exists
            const store = await knex('stores').where({ storeId }).first();
            if (!store) {
                return reply.status(404).send({ error: 'Store not found' });
            }

            // verify that the merchant is associated with the store
            const merchantStore = await knex('merchantStores')
                .where({ merchantId, storeId })
                .first();

            if (!merchantStore) {
                return reply.status(403).send({ error: 'Merchant is not associated with this store' });
            }

            let preferences = await knex('merchantNotificationPreferences')
                .where({ merchantId, storeId })
                .first();

            if (!preferences) {
                // Insert default preferences
                const defaultPreferences = {
                    merchantId,
                    storeId,
                    newOrders: true,
                    chatMessages: true,
                    returnRequests: true,
                    orderCancellations: true,
                    miscellaneous: true,
                    ratingsAndReviews: true,
                    newFollowers: true,
                    muteAll: false,
                };
                await knex('merchantNotificationPreferences').insert(defaultPreferences);
                preferences = defaultPreferences;
            }

            return reply.status(200).send(preferences);
        } catch (err) {
            console.error('Error fetching merchant notification preferences:', err);
            return reply.status(500).send({ error: 'Failed to fetch preferences' });
        }
    });
};