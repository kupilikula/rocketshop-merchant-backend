// Utility function to validate merchant's access to the store
const knex = require("@database/knexInstance");
async function validateMerchantAccessToStore(merchantId, storeId) {
    const store = await knex('merchantStores')
        .where({ storeId, merchantId })
        .first();
    return !!store;
}

module.exports = validateMerchantAccessToStore;