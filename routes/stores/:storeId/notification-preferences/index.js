'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const merchantId = request.user.merchantId;
        const { storeId } = request.params;

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
                return reply.status(404).send({error: 'Preferences not found'})
            }

            return reply.status(200).send(preferences);
        } catch (err) {
            console.error('Error fetching merchant notification preferences:', err);
            return reply.status(500).send({ error: 'Failed to fetch preferences' });
        }
    });

    fastify.patch('/', async (request, reply) => {
        const merchantId = request.user.merchantId;
        const { storeId } = request.params;

        if (!storeId || !merchantId) {
            return reply.status(400).send({ error: 'storeId and merchantId is required' });
        }
        const allowedFields = [
            'newOrders',
            'chatMessages',
            'returnRequests',
            'orderCancellations',
            'miscellaneous',
            'ratingsAndReviews',
            'newFollowers',
            'muteAll'
        ];

        // Filter input to allowed fields only
        const updates = {};
        for (const key of allowedFields) {
            if (request.body.hasOwnProperty(key)) {
                updates[key] = request.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return reply.status(400).send({ error: 'No valid fields provided' });
        }

        try {
            const [updated] = await knex('merchantNotificationPreferences')
                .insert({
                    merchantId,
                    storeId,
                    ...updates
                })
                .onConflict(['merchantId', 'storeId']) // Assumes merchantId is a unique key
                .merge({
                    ...updates,
                    updated_at: knex.fn.now()
                })
                .returning('*');

            return reply.status(200).send(updated);
        } catch (err) {
            console.error('Error updating merchant store notification preferences:', err);
            return reply.status(500).send({ error: 'Failed to update preferences' });
        }
    });
};