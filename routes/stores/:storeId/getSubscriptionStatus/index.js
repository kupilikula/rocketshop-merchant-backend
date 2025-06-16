'use strict';

const knex = require("@database/knexInstance");
const Razorpay = require("razorpay");

const planMap = {
    monthly: {
        id: process.env.MONTHLY_SUBSCRIPTION_PLAN_ID,
        name: 'Monthly Plan',
    },
    annual: {
        id: process.env.ANNUAL_SUBSCRIPTION_PLAN_ID,
        name: 'Annual Plan',
    }
};

// A reverse map to find a plan name from its ID
const planIdToNameMap = Object.values(planMap).reduce((acc, plan) => {
    acc[plan.id] = plan.name;
    return acc;
}, {});

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        try {
            const { storeId } = request.params;
            if (!storeId) {
                return reply.status(404).send({ error: "storeId required" });
            }

            // --- UPDATED QUERY ---
            // Fetch ALL subscriptions for this store that are not yet in a final 'ended' state.
            const subscriptionsFromDb = await knex('storeSubscriptions')
                .where({ storeId })
                .whereIn('subscriptionStatus', ['active', 'cancelled', 'authenticated'])
                .orderBy('created_at', 'asc'); // Order chronologically

            // Map database results to a clean payload, adding the planName
            const subscriptionsPayload = subscriptionsFromDb.map(sub => ({
                subscriptionId: sub.subscriptionId,
                planName: planIdToNameMap[sub.razorpayPlanId],
                subscriptionStatus: sub.subscriptionStatus,
                // Use start_at for authenticated subs, and renewsOn for active/cancelled
                periodStart: sub.currentPeriodStart,
                periodEnd: sub.currentPeriodEnd,
            }));

            // Return the store's overall status and the array of subscriptions
            return reply.send({
                subscriptions: subscriptionsPayload
            });

        } catch (error) {
            fastify.log.error(`Error fetching subscription status:`, error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};