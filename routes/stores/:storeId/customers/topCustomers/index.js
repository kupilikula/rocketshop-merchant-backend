'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/api/merchants/stores/:storeId/customers/top', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch top customers based on total spending
      const topCustomers = await knex('customers')
          .join('orders', 'customers.customerId', 'orders.customerId')
          .where('orders.storeId', storeId)
          .groupBy('customers.customerId')
          .select(
              'customers.customerId',
              'customers.fullName',
              knex.raw('SUM(orders.orderTotal) as totalSpent')
          )
          .orderBy('totalSpent', 'desc')
          .limit(10);

      if (!topCustomers.length) {
        return reply.status(404).send({ error: 'No top customers found for this store.' });
      }

      return reply.send(topCustomers);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch top customers.' });
    }
  });

}
