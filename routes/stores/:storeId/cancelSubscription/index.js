'use strict';

const knex = require("@database/knexInstance");
const Razorpay = require("razorpay");

const planMap = {
    monthly: process.env.MONTHLY_SUBSCRIPTION_PLAN_ID,
    annual: process.env.ANNUAL_SUBSCRIPTION_PLAN_ID
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        try {
            const { storeId } = request.params;

            if (!storeId) {
                return reply.status(404).send({ error: "storeId required." });
            }

            // 1. Find the active subscription for the store in your database
            const activeSubscription = await knex('storeSubscriptions')
                .where({
                    storeId: storeId,
                    subscriptionStatus: 'active'
                })
                .first();

            if (!activeSubscription) {
                return reply.status(400).send({ error: 'No active subscription found to cancel.' });
            }

            // 2. Call Razorpay to cancel the subscription
            fastify.log.info(`Cancelling Razorpay subscription: ${activeSubscription.razorpaySubscriptionId}`);

            // By setting 'cancel_at_cycle_end' to true, the subscription remains active
            // until the current billing period ends, which is the best user experience.
            const cancelledRazorpaySub = await razorpay.subscriptions.cancel(
                activeSubscription.razorpaySubscriptionId,
                { cancel_at_cycle_end: true }
            );
            console.log('cancelled sub:', cancelledRazorpaySub);
            // 3. Update your database to reflect the cancellation
            // The status will become 'cancelled'. The user's store remains `isActive` for now.
            await knex('storeSubscriptions')
                .where('subscriptionId', activeSubscription.subscriptionId)
                .update({
                    subscriptionStatus: 'cancelled',
                    updated_at: new Date()
                });

            // Note: A `subscription.ended` webhook will be sent by Razorpay when the cycle
            // actually ends. You should listen for that webhook to finally set `stores.isActive = false`.

            fastify.log.info(`Subscription ${activeSubscription.razorpaySubscriptionId} successfully cancelled for end of cycle.`);

            return reply.send({ message: 'Subscription successfully cancelled. It will remain active until the end of the current billing period.' });

        } catch (error) {
            fastify.log.error(`Error cancelling subscription:`, error);
            return reply.status(500).send({ error: 'Could not cancel subscription. Please try again later.' });
        }
    });
};