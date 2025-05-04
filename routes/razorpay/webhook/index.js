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

    fastify.post('/', async function (request, reply) {
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
async function processWebhookEvent(payload, log, db) { // Pass knex instance as db
    const eventType = payload.event;
    const eventData = payload?.payload;
    // Use optional chaining for safer access to entity based on event type
    const entity = eventData?.[eventType?.split('.')[0]]?.entity;

    if (!eventType || !eventData || !entity) {
        log.warn({ payload }, "Webhook payload missing expected structure.");
        return;
    }

    // Use Razorpay Order ID for primary lookup, specific entity ID for context
    const primaryEntityId = entity.id; // e.g., payment_id, order_id, transfer_id
    const razorpayOrderId = entity.order_id; // Crucial link back to your mapping

    if (!razorpayOrderId && (eventType.startsWith('payment.') || eventType.startsWith('order.'))) {
        log.error({ payload }, "Webhook payload for payment/order event missing Razorpay Order ID.");
        return; // Cannot map back without order_id
    }

    log.info(`Processing Razorpay Event: ${eventType}, Entity ID: ${primaryEntityId}, Razorpay Order ID: ${razorpayOrderId || 'N/A'}`);

    const trx = await db.transaction();
    try {
        switch (eventType) {
            case 'payment.captured': {
                const paymentId = primaryEntityId; // entity.id is paymentId here
                const amount = entity.amount;
                const currency = entity.currency;
                const newStatus = "Payment Received"; // From your list

                log.info({ razorpayOrderId, paymentId, amount, currency }, `Event: payment.captured. Attempting to update status to "${newStatus}"`);

                // --- Fetch platformOrderIds from the mapping table ---
                const mappings = await trx('razorpay_order_mapping')
                    .select('platformOrderId')
                    .where('razorpayOrderId', razorpayOrderId);

                if (!mappings || mappings.length === 0) {
                    log.error({ razorpayOrderId }, "Could not find associated platform orders in mapping table for Razorpay order ID.");
                    await trx.rollback(); return;
                }
                const platformOrderIds = mappings.map(m => m.platformOrderId);
                // --- End Fetch ---

                for (const platformOrderId of platformOrderIds) {
                    const currentOrder = await trx('orders').where('orderId', platformOrderId).forUpdate().first();
                    if (!currentOrder) {
                        log.warn({ platformOrderId, razorpayOrderId, paymentId }, "Platform order not found during payment capture processing.");
                        continue;
                    }

                    // Idempotency Check
                    if (!POST_PAYMENT_PROCESS_STATUSES.includes(currentOrder.orderStatus)) {
                        log.info({ platformOrderId, paymentId, oldStatus: currentOrder.orderStatus, newStatus }, "Updating order status.");
                        await trx('orders')
                            .where('orderId', platformOrderId)
                            .update({
                                orderStatus: newStatus,
                                orderStatusUpdateTime: new Date(),
                                paymentId: paymentId, // Uses paymentId column
                                updated_at: new Date()
                            });

                        await trx('order_status_history').insert({
                            orderStatusId: uuidv4(),
                            orderId: platformOrderId,
                            orderStatus: newStatus,
                            notes: `Payment captured via Razorpay. ID: ${paymentId}`, // Uses notes column
                        });

                        // Convert Reserved Stock
                        const orderItems = await trx('order_items').where('orderId', platformOrderId);
                        for (const item of orderItems) {
                            const product = await trx('products').where('productId', item.productId).first('reservedStock');
                            if (product && product.reservedStock >= item.quantity) {
                                await trx('products').where('productId', item.productId).decrement('reservedStock', item.quantity);
                                log.info({ productId: item.productId, quantity: item.quantity }, "Decremented reserved stock.");
                            } else { /* log warning */ }
                        }
                        log.info({ platformOrderId }, "Order processed successfully based on payment capture.");
                        // Trigger downstream processes...

                    } else {
                        log.info({ platformOrderId, currentStatus: currentOrder.orderStatus }, "Order already processed post-payment. Skipping update (Idempotency).");
                    }
                }
                break;
            } // End case payment.captured

            case 'payment.failed': {
                const paymentId = primaryEntityId; // entity.id is paymentId here
                const errorCode = entity.error_code;
                const errorDesc = entity.error_description;
                const failedStatus = "Payment Failed"; // From your list

                log.warn({ razorpayOrderId, paymentId, errorCode, errorDesc }, `Event: payment.failed. Attempting to update status to "${failedStatus}"`);

                // --- Fetch platformOrderIds from mapping table ---
                const mappings = await trx('razorpay_order_mapping').select('platformOrderId').where('razorpayOrderId', razorpayOrderId);
                if (!mappings || mappings.length === 0) { /* ... error handle ... */ await trx.rollback(); return; }
                const platformOrderIds = mappings.map(m => m.platformOrderId);
                // --- End Fetch ---

                for (const platformOrderId of platformOrderIds) {
                    const currentOrder = await trx('orders').where('orderId', platformOrderId).forUpdate().first();
                    if (!currentOrder) { /* ... log warning ... */ continue; }

                    // Idempotency Check
                    if (!TERMINAL_OR_POST_PENDING_STATUSES.includes(currentOrder.orderStatus)) {
                        log.warn({ platformOrderId, paymentId, oldStatus: currentOrder.orderStatus, newStatus: failedStatus }, `Updating order status.`);
                        await trx('orders')
                            .where('orderId', platformOrderId)
                            .update({
                                orderStatus: failedStatus,
                                orderStatusUpdateTime: new Date(),
                                paymentId: paymentId, // Uses paymentId column
                                updated_at: new Date()
                            });

                        await trx('order_status_history').insert({
                            orderStatusId: uuidv4(),
                            orderId: platformOrderId,
                            orderStatus: failedStatus,
                            notes: `Payment failed via Razorpay. ID: ${paymentId}. Reason: ${errorCode} - ${errorDesc}`, // Uses notes column
                        });

                        // Release Reserved Stock
                        const orderItems = await trx('order_items').where('orderId', platformOrderId);
                        for (const item of orderItems) {
                            const product = await trx('products').where('productId', item.productId).first('reservedStock');
                            if (product && product.reservedStock >= item.quantity) {
                                await trx('products').where('productId', item.productId).decrement('reservedStock', item.quantity);
                                log.info({ productId: item.productId, quantity: item.quantity }, "Released reserved stock.");
                            } else { /* log warning */ }
                        }
                    } else {
                        log.info({ platformOrderId, currentStatus: currentOrder.orderStatus }, "Order status already terminal/processed. Skipping failure update (Idempotency).");
                    }
                }
                break;
            } // End case payment.failed

            // --- Handle other relevant events ---
            case 'order.paid':
                // Usually less critical if payment.captured is handled robustly
                log.info({ orderId: entity.id }, `Event: order.paid received.`);
                // Can add logic to update to 'Payment Received' here too,
                // ensuring same idempotency checks are used.
                break;

            case 'transfer.processed':
                log.info({ transferId: primaryEntityId, recipient: entity.recipient }, "Event: transfer.processed");
                // Update internal transfer/payout status records if needed
                break;

            case 'transfer.failed':
                log.warn({ transferId: primaryEntityId, recipient: entity.recipient, error: entity.error_reason }, "Event: transfer.failed");
                // Log critical failure, alert administrators
                break;

            default:
                log.info(`Unhandled event type received: ${eventType}`);
        } // End switch

        await trx.commit();
        log.info(`Successfully processed and committed DB changes for event: ${eventType}, Entity ID: ${primaryEntityId}`);

    } catch (dbError) {
        log.error({ err: dbError, eventType, entityId: entity?.id }, "Database error during webhook event processing. Rolling back transaction.");
        await trx.rollback();
        // Log to error monitoring
    }
}

// --- Remember to include the main webhook handler function that verifies ---
// --- the signature and calls processWebhookEvent, as provided previously ---
