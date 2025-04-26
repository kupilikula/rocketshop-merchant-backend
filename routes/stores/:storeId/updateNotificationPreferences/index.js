'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const merchantId = request.user.merchantId;
        const { storeId } = request.body;

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