// src/jobs/cleanupAbandonedOrders.js
'use strict';

const cron = require('node-cron');
const knex = require('../database/knexInstance'); // <<< ADJUST path to your knex instance
const { v4: uuidv4 } = require('uuid');
const Razorpay = require('razorpay'); // <<< Import Razorpay SDK


// --- Configuration ---
// How long an order can stay in 'Order Created' before being considered abandoned
const ABANDONED_THRESHOLD_MINUTES = 30; // e.g., 1 hour. Adjust as needed.
const INITIAL_ORDER_STATUS = "Order Created"; // The status to look for
const FAILED_STATUS = "Failed"; // The status to set for abandoned orders

// --- Initialize Razorpay SDK ---
// Ensure keys correspond to the environment (Test/Live) where the orders were created
let razorpayInstance;
try {
    razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
} catch(initError) {
    console.error("[Cron Job - Abandoned Orders] Failed to initialize Razorpay SDK:", initError);
    // Consider exiting or preventing job scheduling if SDK init fails critically
    razorpayInstance = null; // Ensure it's null if failed
}

/**
 * Finds and processes orders that were created but likely abandoned before payment.
 * Marks them as 'Failed' and releases reserved stock.
 */
async function cancelAbandonedOrders() {
    const cutoffTime = new Date(Date.now() - ABANDONED_THRESHOLD_MINUTES * 60 * 1000);
    const logger = console; // Replace with your actual logger instance if you have one

    // Exit if Razorpay SDK failed to initialize
    if (!razorpayInstance) {
        logger.error("[Cron Job - Abandoned Orders] Cannot run: Razorpay SDK not initialized.");
        return;
    }

    logger.info(`[Cron Job - Abandoned Orders] Running check for orders created before ${cutoffTime.toISOString()} with status '${INITIAL_ORDER_STATUS}'...`);

    let processedCount = 0;
    let errorCount = 0;
    let skippedPaidCount = 0;

    try {
        // Find potentially abandoned orders
        const abandonedOrders = await knex('orders')
            .select('orderId')
            .where('orderStatus', INITIAL_ORDER_STATUS)
            .andWhere('created_at', '<', cutoffTime); // Use the creation timestamp

        if (abandonedOrders.length === 0) {
            logger.info("[Cron Job - Abandoned Orders] No abandoned orders found matching criteria.");
            return;
        }

        logger.info(`[Cron Job - Abandoned Orders] Found ${abandonedOrders.length} potential orders. Processing...`);

        // Process each order individually to isolate errors
        for (const order of abandonedOrders) {
            const platformOrderId = order.orderId;
            const trx = await knex.transaction(); // Use a transaction for atomicity
            try {
                // Lock the order row to prevent race conditions (e.g., with a late webhook)
                const currentOrder = await trx('orders')
                    .where('orderId', platformOrderId)
                    .forUpdate() // Pessimistic lock
                    .first();

                // Verify the order still exists and is still in the initial state
                if (!currentOrder) {
                    logger.warn(`[Cron Job - Abandoned Orders] Order ${platformOrderId} not found during processing lock. Skipping.`);
                    await trx.rollback(); // Rollback (though nothing happened yet)
                    continue;
                }

                if (currentOrder.orderStatus !== INITIAL_ORDER_STATUS) {
                    logger.info(`[Cron Job - Abandoned Orders] Order ${platformOrderId} status changed to '${currentOrder.orderStatus}' before cleanup. Skipping.`);
                    await trx.rollback();
                    continue;
                }

                // --- Enhancement: Check Razorpay Order Status ---
                let proceedWithCancel = true; // Assume cancellation unless RZP says paid

                const razorpayOrderId = currentOrder.razorpayOrderId;
                logger.info(`[Cron Job - Abandoned Orders Enhanced] Checking status for RZP Order ${razorpayOrderId} (Platform: ${platformOrderId})...`);

                try {
                    const rzpOrder = await razorpayInstance.orders.fetch(razorpayOrderId);
                    const rzpStatus = rzpOrder?.status; // 'created', 'attempted', 'paid'

                    logger.info(`[Cron Job - Abandoned Orders Enhanced] RZP Order ${razorpayOrderId} status: ${rzpStatus}`);

                    if (rzpStatus === 'paid') {
                        // Order IS PAID on Razorpay, but webhook might have failed/delayed.
                        // DO NOT CANCEL. Log this inconsistency for investigation.
                        logger.error(`[Cron Job - Abandoned Orders Enhanced] INCONSISTENCY: Platform order ${platformOrderId} is '${INITIAL_ORDER_STATUS}', but Razorpay order ${razorpayOrderId} is 'paid'. Skipping cancellation. ACTION NEEDED.`);
                        proceedWithCancel = false;
                        skippedPaidCount++;
                        // --- Advanced: Optionally try to trigger webhook processing logic here ---
                        // This is complex: need payment entity details, ensure idempotency.
                        // Example: await processMissedWebhook('payment.captured', rzpOrder, logger, trx);
                        // For now, logging is safer. Manually investigate these inconsistencies.

                    } else if (rzpStatus === 'attempted' || rzpStatus === 'created') {
                        // Order not paid on Razorpay. Safe to proceed with cancellation.
                        logger.info(`[Cron Job - Abandoned Orders Enhanced] RZP Order ${razorpayOrderId} is not paid ('${rzpStatus}'). Proceeding with cancellation.`);
                        proceedWithCancel = true;
                    } else {
                        // Unexpected status
                        logger.warn(`[Cron Job - Abandoned Orders Enhanced] Unexpected status '${rzpStatus}' for RZP order ${razorpayOrderId}. Proceeding with cancellation cautiously.`);
                        proceedWithCancel = true; // Default to cancelling if status is unknown after timeout
                    }

                } catch (razorpayError) {
                    // Handle API errors (e.g., order not found 404, network error, auth error)
                    if (razorpayError.statusCode === 404) {
                        logger.warn(`[Cron Job - Abandoned Orders Enhanced] Razorpay Order ${razorpayOrderId} not found on Razorpay (404). Proceeding with cancellation.`);
                        proceedWithCancel = true;
                    } else {
                        logger.error(`[Cron Job - Abandoned Orders Enhanced] Error fetching RZP Order ${razorpayOrderId}: ${razorpayError.message || razorpayError.description || 'Unknown API Error'}. Proceeding with cancellation cautiously.`);
                        // Decide policy: cancel or skip on API errors? Cancelling seems reasonable if RZP status unknown after timeout.
                        proceedWithCancel = true;
                    }
                    // Log the detailed error if available
                    if (razorpayError.error) logger.error({ rzpErrorDetails: razorpayError.error });
                }

                // --- End Enhancement Check ---


                if (proceedWithCancel) {
                    logger.info(`[Cron Job - Abandoned Orders Enhanced] Updating Order ${platformOrderId} status to '${FAILED_STATUS}'.`);
                    await trx('orders')
                        .where('orderId', platformOrderId)
                        .update({
                            orderStatus: FAILED_STATUS,
                            orderStatusUpdateTime: new Date(),
                            updated_at: new Date()
                        });

                    await trx('order_status_history').insert({
                        orderStatusId: uuidv4(),
                        orderId: platformOrderId,
                        orderStatus: FAILED_STATUS,
                        notes: `Order automatically marked as Failed due to abandonment timeout (${ABANDONED_THRESHOLD_MINUTES} mins).`,
                    });

                    // Release Reserved Stock
                    const orderItems = await trx('order_items').where('orderId', platformOrderId);
                    logger.info(`[Cron Job - Abandoned Orders Enhanced] Releasing stock for ${orderItems.length} items in order ${platformOrderId}.`);
                    for (const item of orderItems) {
                        // ... (safe decrement logic as before) ...
                        const product = await trx('products').where('productId', item.productId).first('reservedStock');
                        if (product && product.reservedStock >= item.quantity) {
                            await trx('products').where('productId', item.productId).decrement('reservedStock', item.quantity);
                            logger.info(`[Cron Job - Abandoned Orders Enhanced] Released ${item.quantity} for product ${item.productId}.`);
                        } else { /* log warning */ }
                    }
                    processedCount++;
                    await trx.commit(); // Commit changes for this order
                    logger.info(`[Cron Job - Abandoned Orders Enhanced] Successfully processed order ${platformOrderId} as Failed.`);
                } else {
                    // If cancellation was skipped (e.g., RZP order was 'paid')
                    await trx.rollback(); // Rollback the transaction as no action was taken
                    logger.info(`[Cron Job - Abandoned Orders Enhanced] Rolled back transaction for ${platformOrderId} - cancellation skipped.`);
                }


            } catch (err) {
                await trx.rollback(); // Rollback transaction on any error for this order
                logger.error(`[Cron Job - Abandoned Orders] Error processing order ${platformOrderId}: ${err.message}`, err.stack);
                errorCount++;
            }
        } // End loop

        logger.info(`[Cron Job - Abandoned Orders] Finished run. Processed: ${processedCount}, Errors: ${errorCount}.`);

    } catch (error) {
        logger.error(`[Cron Job - Abandoned Orders] Error fetching abandoned orders: ${error.message}`, error.stack);
    }
}

/**
 * Schedules the cleanup job to run periodically.
 */
function scheduleOrderCleanupJob() {
    // Cron syntax examples:
    // '*/15 * * * *' : Every 15 minutes
    // '0 * * * *'    : Every hour at minute 0
    // '0 0 * * *'    : Once a day at midnight
    const cronSchedule = '*/15 * * * *'; // Run every 15 minutes

    // Validate the schedule syntax before scheduling
    if (!cron.validate(cronSchedule)) {
        console.error(`[Cron Job - Abandoned Orders] Invalid cron schedule syntax: ${cronSchedule}`);
        return;
    }

    console.log(`[Cron Job - Abandoned Orders] Scheduling cleanup with schedule: "${cronSchedule}" (Timezone: Asia/Kolkata)`);

    cron.schedule(cronSchedule, () => {
        console.log(`[Cron Job - Abandoned Orders] Triggered at ${new Date().toISOString()}`);
        // Wrap the async function call to catch any unhandled promise rejections from it
        cancelAbandonedOrders().catch(jobError => {
            console.error(`[Cron Job - Abandoned Orders] Unhandled error during job execution: ${jobError.message}`, jobError.stack);
        });
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Use your desired timezone (IST)
    });

    console.log("[Cron Job - Abandoned Orders] Cleanup job scheduled successfully.");
}

module.exports = {
    scheduleOrderCleanupJob,
    cancelAbandonedOrders // Export if you want to run it manually sometimes
};