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
                    'merchantStores.merchantRole': 'Admin'                // Ensure user is an Admin
                })
                .whereIn('storeSubscriptions.subscriptionStatus', ['active', 'authenticated'])
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
            fastify.log.error(`Error cancelling subscription:`, error);
            return reply.status(500).send({ error: 'Could not cancel subscription. Please try again later.' });
        }
    });
};