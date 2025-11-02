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

const planMapObject = {
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
const planIdToNameMap = Object.values(planMapObject).reduce((acc, plan) => {
    acc[plan.id] = plan.name;
    return acc;
}, {});

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

    fastify.delete('/', async (request, reply) => {

        const trx = await knex.transaction();

        try {
            const { storeId } = request.params;
            const {merchantId} = request.user;
            const {subscriptionId} = request.body;

            if (!storeId) {
                return reply.status(404).send({ error: "storeId required." });
            }

            const subscriptionToCancel = await trx('storeSubscriptions')
                .join('stores', 'storeSubscriptions.storeId', 'stores.storeId')
                .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
                .where({
                    'storeSubscriptions.subscriptionId': subscriptionId, // Match the specific sub
                    'merchantStores.merchantId': merchantId,              // Ensure ownership
                    'storeSubscriptions.subscriptionStatus': 'active',    // Ensure it's in a cancellable state
                    'merchantStores.merchantRole': 'Owner'                // Ensure user is an Owner
                })
                .select('storeSubscriptions.*') // Select all columns from the subscription table
                .first();

            if (!subscriptionToCancel) {
                await trx.rollback();
                return reply.status(404).send({ error: 'Cancellable subscription not found or you do not have permission to modify it.' });
            }

            // 2. Call Razorpay to schedule the cancellation
            fastify.log.info(`Cancelling Razorpay subscription: ${subscriptionToCancel.razorpaySubscriptionId}`);
            await razorpay.subscriptions.cancel(
                subscriptionToCancel.razorpaySubscriptionId,
                { cancel_at_cycle_end: true }
            );

            // 3. Update YOUR database status to 'cancelled'
            await trx('storeSubscriptions')
                .where('subscriptionId', subscriptionToCancel.subscriptionId)
                .update({
                    subscriptionStatus: 'cancelled',
                    updated_at: new Date()
                });

            // Commit all changes if successful
            await trx.commit();

            fastify.log.info(`Subscription ${subscriptionToCancel.razorpaySubscriptionId} successfully marked as 'cancelled' for end of cycle.`);

            return reply.send({ success: true, message: 'Subscription successfully scheduled for cancellation.' });

        } catch (error) {
            await trx.rollback();

            // --- NEW: Detailed Error Logging ---
            console.log("--- RAW ERROR OBJECT FROM RAZORPAY ---");
            console.log(error); // This will dump the raw object to your console/logs.

            fastify.log.error({
                // Log specific properties that are likely to exist and be serializable.
                name: error.name,
                message: error.message,
                stack: error.stack,
                // These are common properties in Razorpay's error object
                statusCode: error.statusCode,
                razorpayErrorCode: error.error?.code,
                razorpayErrorDescription: error.error?.description,
            }, "Detailed error while cancelling subscription:");
            // --- END OF NEW DETAILED LOGGING ---
            fastify.log.error(`Error cancelling subscription:`, error);
            return reply.status(500).send({ error: 'Could not cancel subscription. Please try again later.' });
        }
    });

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