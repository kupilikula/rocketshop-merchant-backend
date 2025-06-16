// routes/webhooks/razorpay.js (Example path)
'use strict'

const crypto = require('crypto');
const knex = require('@database/knexInstance'); // Your Knex instance
const { v4: uuidv4 } = require('uuid');
const {getPendingOrderStatuses, getInProgressOrderStatuses, getFulfilledOrderStatuses, getOnHoldOrderStatuses,
    getCanceledOrFailedOrderStatuses, getRefundedOrReturnedOrderStatuses
} = require("../../../utils/orderStatusList");

// --- Define status groups based on your constants for easier checks ---
// These could also be imported if defined comprehensively in the constants file
const PENDING_STATUSES = getPendingOrderStatuses(); // e.g., ["Order Created", "Payment Initiated"]
const IN_PROGRESS_STATUSES = getInProgressOrderStatuses(); // e.g., ["Payment Received", "Processing", ...]
const FULFILLED_STATUSES = getFulfilledOrderStatuses();
const ON_HOLD_STATUSES = getOnHoldOrderStatuses();
const CANCELED_OR_FAILED_STATUSES = getCanceledOrFailedOrderStatuses(); // Includes "Payment Failed", "Canceled", "Failed"
const REFUNDED_OR_RETURNED_STATUSES = getRefundedOrReturnedOrderStatuses();

// Statuses indicating payment was successful and processing/fulfillment started or completed,
// or the order is in a state that cannot revert to pending.
const POST_PAYMENT_PROCESS_STATUSES = [
    ...IN_PROGRESS_STATUSES,
    ...FULFILLED_STATUSES,
    ...ON_HOLD_STATUSES, // Assuming On Hold can happen after payment
    ...REFUNDED_OR_RETURNED_STATUSES // Refunds happen after payment
];

// Statuses indicating the order reached a final non-pending state (paid, failed, cancelled etc.)
// Used to prevent marking a completed/failed order as failed again incorrectly.
const TERMINAL_OR_POST_PENDING_STATUSES = [
    ...POST_PAYMENT_PROCESS_STATUSES,
    ...CANCELED_OR_FAILED_STATUSES
];


// --- Helper function for timing-safe comparison (optional but recommended) ---
const safeCompare = (a, b) => {
    try {
        // Ensure inputs are buffers for timingSafeEqual
        const bufA = Buffer.from(a, 'utf8');
        const bufB = Buffer.from(b, 'utf8');
        if (bufA.length !== bufB.length) {
            return false;
        }
        return crypto.timingSafeEqual(bufA, bufB);
    } catch (error) {
        // Log the error if needed
        console.error("Error during safe comparison:", error);
        return false;
    }
};

module.exports = async function (fastify, opts) {

    // --- IMPORTANT: Raw Body Configuration ---
    // Ensure Fastify provides request.rawBody (e.g., via fastify-raw-body plugin)
    // Example plugin registration config: { field: 'rawBody', encoding: 'utf8', runFirst: true }
    // Without the raw body, signature verification *will not work*.

    fastify.post('/', {
        config: {
            rawBody: true // This enables the fastify-raw-body plugin for this route
        },
    }, async function (request, reply) {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const receivedSignature = request.headers['x-razorpay-signature'];
        // Use the raw body provided by Fastify config/plugin
        const rawRequestBody = request.rawBody || request.body; // Fallback might not work, ensure rawBody is set

        // --- 1. Input Validation ---
        if (!webhookSecret) {
            fastify.log.error("RAZORPAY_WEBHOOK_SECRET is not configured.");
            return reply.status(500).send({ status: 'error', message: 'Internal Server Error' });
        }
        if (!receivedSignature) {
            fastify.log.warn("Webhook received without X-Razorpay-Signature.");
            return reply.status(400).send({ status: 'error', message: 'Signature missing' });
        }
        if (!rawRequestBody) {
            fastify.log.error("Raw request body not available for webhook verification. Check Fastify config.");
            return reply.status(500).send({ status: 'error', message: 'Internal Server Error' });
        }

        try {
            // --- 2. Verify Signature ---
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(rawRequestBody) // Use the RAW string/buffer body
                .digest('hex');

            // Use safeCompare or direct comparison
            const isValidSignature = safeCompare(expectedSignature, receivedSignature);
            // const isValidSignature = (expectedSignature === receivedSignature); // Less secure alternative

            if (!isValidSignature) {
                fastify.log.warn({ received: receivedSignature }, "Invalid Razorpay webhook signature received.");
                return reply.status(400).send({ status: 'error', message: 'Invalid signature' });
            }

            // --- Signature is valid ---
            fastify.log.info("Razorpay webhook signature verified.");

            // --- 3. Parse Payload ---
            // If using rawBody, parse it now. If Fastify already parsed request.body AND rawBody is available, use request.body
            const eventPayload = (typeof rawRequestBody === 'string' && request.headers['content-type']?.includes('application/json'))
                ? JSON.parse(rawRequestBody)
                : request.body; // Assuming Fastify parsed it if not raw

            // --- 4. Acknowledge Razorpay Immediately ---
            reply.code(200).send({ status: 'received' });

            // --- 5. Process Event Asynchronously (Recommended) ---
            // Using await here for simplicity, but for production, consider pushing
            // eventPayload to a job queue (e.g., BullMQ, Kue) and processing it
            // in a separate worker to keep the webhook endpoint fast.
            try {
                await processWebhookEvent(eventPayload, fastify.log, knex); // Pass logger and knex
            } catch (processingError) {
                fastify.log.error({ err: processingError, event: eventPayload?.event }, "Error processing webhook event payload after acknowledgment.");
                // Log error, notify monitoring system (e.g., Sentry)
            }

        } catch (error) {
            fastify.log.error({ err: error }, "General error in Razorpay webhook handler before acknowledgment.");
            if (!reply.sent) {
                // Send error only if we haven't already acknowledged with 200 OK
                return reply.status(500).send({ status: 'error', message: 'Internal Server Error' });
            }
            // If error happened after reply.sent, the error is logged above.
        }
    });
};

// --- Helper function to contain the core processing logic ---
// --- Refactored Webhook Processing Function ---

// --- Main Processing Function ---

async function processWebhookEvent(payload, log, db) { // knex instance passed as db
    const eventType = payload.event;
    const entity = payload.payload?.[eventType.split('.')[0]]?.entity;

    if (!eventType || !entity) {
        log.warn({ payload }, "Webhook payload missing expected structure. Skipping.");
        return;
    }

    // Use the subscription ID as the primary link
    const razorpaySubscriptionId = entity.id;
    const storeId = entity.notes?.store_id;
    log.info(`Processing Razorpay Event: ${eventType}, Entity ID: ${entity.id}`);

    // Use a single transaction for all database operations for this event.
    const trx = await db.transaction();
    try {
        switch (eventType) {
            // --- Subscription Event Handling ---
            case 'subscription.authenticated': {
                if (!storeId) {
                    log.error({ razorpaySubscriptionId }, "Webhook Error: store_id missing from notes.");
                    await trx.rollback();
                    return;
                }

                log.info({ storeId, subId: razorpaySubscriptionId }, "Event: subscription.authenticated. Creating/updating record in 'authenticated' state.");

                // Your existing logic for calculating future dates is perfect.
                // We will use it here to ensure the record is created with the correct dates.
                let periodStart = entity.current_start;
                let periodEnd = entity.current_end;

                if (!periodStart && entity.start_at) {
                    const startDate = new Date(entity.start_at * 1000);
                    periodStart = entity.start_at;
                    const endDate = new Date(startDate);
                    let planPeriod;
                    if (entity.plan_id === process.env.RAZORPAY_MONTHLY_PLAN_ID) {
                        planPeriod = 'monthly';
                    } else if (entity.plan_id === process.env.RAZORPAY_ANNUAL_PLAN_ID) {
                        planPeriod = 'yearly';
                    }
                    if (planPeriod === 'monthly') endDate.setMonth(endDate.getMonth() + 1);
                    else if (planPeriod === 'yearly') endDate.setFullYear(endDate.getFullYear() + 1);
                    periodEnd = Math.floor(endDate.getTime() / 1000);
                }

                const subscriptionData = {
                    storeId: storeId,
                    razorpayPlanId: entity.plan_id,
                    razorpaySubscriptionId: razorpaySubscriptionId,
                    subscriptionStatus: 'authenticated', // Set this specific status
                    currentPeriodStart: periodStart ? db.raw('to_timestamp(?)', [periodStart]) : null,
                    currentPeriodEnd: periodEnd ? db.raw('to_timestamp(?)', [periodEnd]) : null,
                    updated_at: new Date()
                };

                // Use the robust "upsert" logic
                await trx('storeSubscriptions')
                    .insert({ ...subscriptionData, subscriptionId: uuidv4(), created_at: new Date() })
                    .onConflict('razorpaySubscriptionId').merge(subscriptionData);
                break;
            }

            case 'subscription.charged': {
                if (!storeId) {
                    log.error({ razorpaySubscriptionId }, "Webhook Error: store_id missing from notes.");
                    await trx.rollback();
                    return;
                }

                log.info({ storeId, subId: razorpaySubscriptionId }, "Event: subscription.charged. Updating subscription to 'active'.");

                const subscriptionData = {
                    storeId: storeId,
                    razorpayPlanId: entity.plan_id,
                    razorpaySubscriptionId: razorpaySubscriptionId,
                    subscriptionStatus: 'active', // The key action is to make it active
                    currentPeriodStart: db.raw('to_timestamp(?)', [entity.current_start]),
                    currentPeriodEnd: db.raw('to_timestamp(?)', [entity.current_end]),
                    updated_at: new Date()
                };

                // "Upsert" the record. This handles both immediate-start new subs (INSERT)
                // and the first charge of future-dated subs (UPDATE).
                await trx('storeSubscriptions')
                    .insert({ ...subscriptionData, subscriptionId: uuidv4(), created_at: new Date() })
                    .onConflict('razorpaySubscriptionId').merge(subscriptionData);

                // Now, ensure the store is active.
                await trx('stores').where('storeId', storeId).update({ isActive: true });
                log.info({ storeId }, "Store activation confirmed on charge.");
                break;
            }

            // Add this new case to your switch statement in processWebhookEvent

            case 'subscription.ended': {
                const subscription = entity;
                const razorpaySubscriptionId = subscription.id;

                log.info({ razorpaySubscriptionId }, "Event: subscription.ended. Deactivating store and updating subscription status.");

                // 1. Find the subscription in your database using the ID from Razorpay.
                const localSubscription = await trx('storeSubscriptions')
                    .where('razorpaySubscriptionId', razorpaySubscriptionId)
                    .forUpdate() // Lock the row for the transaction
                    .first();

                if (!localSubscription) {
                    log.error({ razorpaySubscriptionId }, "Webhook Error: Received 'subscription.ended' event for a subscription not found in our database.");
                    await trx.rollback();
                    return;
                }

                const { storeId } = localSubscription;

                // 2. Update the subscription's status in your database to 'ended' to match Razorpay.
                await trx('storeSubscriptions')
                    .where('razorpaySubscriptionId', razorpaySubscriptionId)
                    .update({
                        subscriptionStatus: 'ended', // Reflect the final state
                        updated_at: new Date(),
                    });

                // 3. Deactivate the associated store.
                await trx('stores')
                    .where('storeId', storeId)
                    .update({
                        isActive: false,
                    });

                log.info({ storeId, razorpaySubscriptionId }, "Store has been successfully deactivated as its subscription period has ended.");
                break;
            }

            case 'subscription.activated': {
                log.info({ subscriptionId: entity.id }, "Event: subscription.activated received. No action taken as 'charged'/'authenticated' handles activation.");
                break;
            }

            // --- Refactored Order Event Handling ---
            case 'payment.captured': {
                const payment = entity;
                const razorpayOrderId = payment.order_id;
                const newStatus = "Payment Received";

                if (!razorpayOrderId) {
                    log.error({ paymentId: payment.id }, "Webhook Error: razorpay_order_id missing from payment entity.");
                    await trx.rollback();
                    return;
                }

                const order = await trx('orders').where('razorpayOrderId', razorpayOrderId).forUpdate().first();

                if (!order) {
                    log.error({ razorpayOrderId }, "Could not find an associated platform order for this Razorpay order ID.");
                    await trx.rollback();
                    return;
                }

                if (!POST_PAYMENT_PROCESS_STATUSES.includes(order.orderStatus)) {
                    await trx('orders')
                        .where('orderId', order.orderId)
                        .update({
                            orderStatus: newStatus,
                            orderStatusUpdateTime: new Date(),
                            paymentId: payment.id,
                            updated_at: new Date()
                        });

                    await trx('order_status_history').insert({
                        orderStatusId: uuidv4(),
                        orderId: order.orderId,
                        orderStatus: newStatus,
                        notes: `Payment captured via Razorpay. ID: ${payment.id}`,
                    });

                    log.info({ platformOrderId: order.orderId, paymentId: payment.id }, "Order status updated to 'Payment Received'.");

                    const orderItems = await trx('order_items').where('orderId', order.orderId);
                    for (const item of orderItems) {
                        // This moves stock from "reserved" to "sold" (by decrementing reserved)
                        await trx('products').where('productId', item.productId).decrement('reservedStock', item.quantity);
                        log.info({ productId: item.productId, quantity: item.quantity }, "Decremented reserved stock upon successful payment.");
                    }
                } else {
                    log.info({ platformOrderId: order.orderId, currentStatus: order.orderStatus }, "Order already processed post-payment. Skipping update (Idempotency).");
                }
                break;
            }

            case 'payment.failed': {
                const payment = entity;
                const razorpayOrderId = payment.order_id;
                const failedStatus = "Payment Failed";

                if (!razorpayOrderId) {
                    log.error({ paymentId: payment.id }, "Webhook Error: razorpay_order_id missing from payment entity on failure event.");
                    await trx.rollback();
                    return;
                }

                const order = await trx('orders').where('razorpayOrderId', razorpayOrderId).forUpdate().first();

                if (!order) {
                    log.error({ razorpayOrderId }, "Could not find an associated platform order for this failed payment.");
                    await trx.rollback();
                    return;
                }

                if (!TERMINAL_OR_POST_PENDING_STATUSES.includes(order.orderStatus)) {
                    await trx('orders')
                        .where('orderId', order.orderId)
                        .update({
                            orderStatus: failedStatus,
                            orderStatusUpdateTime: new Date(),
                            paymentId: payment.id,
                            updated_at: new Date()
                        });

                    await trx('order_status_history').insert({
                        orderStatusId: uuidv4(),
                        orderId: order.orderId,
                        orderStatus: failedStatus,
                        notes: `Payment failed via Razorpay. ID: ${payment.id}. Reason: ${payment.error_code} - ${payment.error_description}`,
                    });

                    log.warn({ platformOrderId: order.orderId }, "Order status updated to 'Payment Failed'. Releasing reserved stock.");

                    const orderItems = await trx('order_items').where('orderId', order.orderId);
                    for (const item of orderItems) {
                        // This releases the stock from "reserved" back into the main pool.
                        await trx('products').where('productId', item.productId)
                            .increment('stockQuantity', item.quantity)
                            .decrement('reservedStock', item.quantity);
                        log.info({ productId: item.productId, quantity: item.quantity }, "Released reserved stock due to payment failure.");
                    }
                } else {
                    log.info({ platformOrderId: order.orderId, currentStatus: order.orderStatus }, "Order status already terminal/processed. Skipping failure update (Idempotency).");
                }
                break;
            }

            // You can add other cases like 'transfer.processed' here if needed.
            default:
                log.info(`Unhandled event type received and ignored: ${eventType}`);
        }

        await trx.commit();
        log.info(`Successfully processed and committed DB changes for event: ${eventType}`);

    } catch (dbError) {
        log.error({ err: dbError, eventType }, "Database error during webhook event processing. Rolling back transaction.");
        await trx.rollback();
        // Re-throwing the error is good practice if you have an external service
        // that monitors for unhandled promise rejections or errors.
        throw dbError;
    }
}

// --- Remember to include the main webhook handler function that verifies ---
// --- the signature and calls processWebhookEvent, as provided previously ---
