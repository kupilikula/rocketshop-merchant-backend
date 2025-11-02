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
        const { storeId, planType } = request.body;
        const { merchantId } = request.user;

        if (!storeId) {
            return reply.status(400).send({ error: 'storeId is required' });
        }
        if (!['monthly', 'annual'].includes(planType)) {
            return reply.status(400).send({ error: 'Invalid planType.' });
        }

        const planId = planMap[planType];

        if (!planId) {
            return reply.status(400).send({ error: 'Invalid plan type specified.' });
        }

        const merchant = await knex('merchants')
            .join('merchantStores', 'merchants.merchantId', '=', 'merchantStores.merchantId')
            .where({'merchants.merchantId': merchantId, 'merchantStores.storeId': storeId})
            .select('merchants.phone', 'merchants.email', 'merchantStores.merchantRole')
            .first();

        if (!merchant || merchant.merchantRole !== 'Owner') {
            return reply.status(400).send({ error: 'Merchant not found or does not have permission to create subscriptions.' });
        }

        const store = await knex('stores').where({storeId}).select('isPlatformOwned').first();
        if (!store || store.isPlatformOwned) {
            return reply.status(400).send({ error: 'Store not found or not supported for subscriptions.' });
        }

        let notify_info= {};
        if (merchant.phone) {
            notify_info.notify_phone = merchant.phone;
        }
        if (merchant.email) {
            notify_info.notify_email = merchant.email;
        }

        // `total_count` is the number of billing cycles for the subscription.
        // For a monthly plan, 60 cycles = 5 years. For annual, 10 cycles = 10 years.
        const subscriptionParams = {
            plan_id: planId,
            total_count: planType === 'annual' ? 1 : 12,
            quantity: 1,
            customer_notify: true, // Let Razorpay handle payment notification emails
            notes: {
                // VERY IMPORTANT: Store your internal storeId in the notes.
                // This allows your webhook handler to link the payment back to the correct store.
                store_id: storeId,
            },
            notify_info: notify_info,
        };

        // --- NEW LOGIC TO PREVENT OVERLAP ---
        // Before creating, check if there's a subscription that was cancelled but is still active.
        const existingCancelledSub = await knex('storeSubscriptions')
            .where({ storeId: storeId, subscriptionStatus: 'cancelled' })
            .orderBy('currentPeriodEnd', 'desc') // Get the one that ends latest
            .first();

        // Check if the found subscription's end date is actually in the future.
        if (existingCancelledSub && new Date(existingCancelledSub.currentPeriodEnd) > new Date()) {
            fastify.log.info(
                `Found existing cancelled sub for store ${storeId} ending on ${existingCancelledSub.currentPeriodEnd}. ` +
                `Scheduling new subscription to start then.`
            );

            // Convert the JavaScript/ISO date from your DB to a Unix timestamp (in seconds) for Razorpay.
            const startDate = new Date(existingCancelledSub.currentPeriodEnd);
            subscriptionParams.start_at = Math.floor(startDate.getTime() / 1000);
        }
        // --- END OF NEW LOGIC ---

        try {
            fastify.log.info(`Creating Razorpay subscription for store: ${storeId} with plan: ${planType}`);

            const subscription = await razorpay.subscriptions.create(subscriptionParams);

            fastify.log.info(`Successfully created subscription ${subscription.id} for store: ${storeId}`);

            // As per our last discussion, we return the simple subscription link.
            return reply.send({
                subscriptionId: subscription.id,
                subscription_url: subscription.short_url,
            });

        } catch (error) {
            fastify.log.error(`Razorpay subscription creation failed for store ${storeId}:`, error);
            // Avoid sending detailed Razorpay errors to the client.
            return reply.status(500).send({ error: 'Failed to create subscription. Please try again later.' });
        }
    });
};