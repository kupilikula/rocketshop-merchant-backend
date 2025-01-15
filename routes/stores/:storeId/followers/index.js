'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;
    const merchantId = request.user.merchantId; // Assuming authentication middleware adds this

    try {
      // Verify the store belongs to the merchant
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch followers of the store
      const followers = await knex('customer_followed_stores as cfs')
          .select('c.customerId', 'c.fullName', 'c.email', 'c.phone', 'c.customerAddress', 'cfs.followed_at')
          .join('customers as c', 'cfs.customerId', 'c.customerId')
          .where('cfs.storeId', storeId)
          .orderBy('cfs.followed_at', 'desc');

      return reply.send({ followers });
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch followers.' });
    }
  });
}
