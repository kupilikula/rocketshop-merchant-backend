'use strict';

const knex = require("@database/knexInstance");
/**
 * Checks if a store meets all criteria to be activated.
 * @param {object} params - The function parameters.
 * @param {string} params.storeId - The UUID of the store to check.
 * @param {object} params.knex - The Knex instance for database queries.
 * @returns {Promise<object>} An object containing the readiness status and details.
 */
async function checkStoreActivationReadiness({ store }) {
    const checks = {
        isPlatformOwned: false,
        hasActiveSubscription: false,
        hasActiveProducts: false,
    };

    checks.isPlatformOwned = store.isPlatformOwned;

    // 2. Check for at least one active product
    const activeProduct = await knex('products').where({ storeId: store.storeId, isActive: true }).first();
    if (activeProduct) {
        checks.hasActiveProducts = true;
    }

    // 3. Check for a valid subscription (if not platform-owned)
    if (store.isPlatformOwned) {
        checks.hasActiveSubscription = true; // Platform-owned stores don't need a subscription
    } else {
        const subscription = await knex('storeSubscriptions')
            .where({ storeId: store.storeId })
            .whereIn('subscriptionStatus', ['active', 'cancelled'])
            .first();
        if (subscription) {
            checks.hasActiveSubscription = true;
        }
    }

    // Determine the final readiness status
    const isReady = checks.hasActiveProducts && checks.hasActiveSubscription;
    let message = 'Store is ready for activation.';
    if (!isReady) {
        if (!checks.hasActiveSubscription) {
            message = 'An active subscription is required to activate the store.';
        } else if (!checks.hasActiveProducts) {
            message = 'You must have at least one active product before activating your store.';
        }
    }

    return { isReady, checks, message };
}

module.exports = {
    checkStoreActivationReadiness,
};