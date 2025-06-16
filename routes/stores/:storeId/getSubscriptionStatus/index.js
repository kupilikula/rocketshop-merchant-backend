'use strict';

const knex = require("@database/knexInstance");
const Razorpay = require("razorpay");

const planMap = {
    monthly: {
        id: process.env.RAZORPAY_MONTHLY_PLAN_ID,
        name: 'Monthly Plan',
    },
    annual: {
        id: process.env.RAZORPAY_ANNUAL_PLAN_ID,
        name: 'Annual Plan',
    }
};

// A reverse map to find a plan name from its ID
const planIdToNameMap = Object.values(planMap).reduce((acc, plan) => {
    acc[plan.id] = plan.name;
    return acc;
}, {});

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        try {
            
            const { storeId } = request.params;

            if (!storeId) {
                return reply.status(404).send({ error: "No store associated with this user." });
            }

            // Find the most recent subscription for this store to determine its status
            const subscription = await knex('storeSubscriptions')
                .where('storeId', storeId)
                .orderBy('created_at', 'desc') // Get the latest one
                .first();

            // Also get the store's own active status
            const store = await knex('stores').where('storeId', storeId).first('isActive');

            if (!subscription) {
                // No subscription record found at all
                return reply.send({
                    isActive: store ? store.isActive : false,
                    planName: null,
                    subscriptionStatus: 'not_found',
                    renewsOn: null,
                });
            }

            // Found a subscription, so format the response for the frontend
            const responsePayload = {
                isActive: store.isActive,
                planName: planIdToNameMap[subscription.razorpayPlanId],
                subscriptionStatus: subscription.subscriptionStatus,
                renewsOn: subscription.currentPeriodEnd, // This is a timestamp
            };

            return reply.send(responsePayload);

        } catch (error) {
            fastify.log.error(`Error fetching subscription status:`, error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};