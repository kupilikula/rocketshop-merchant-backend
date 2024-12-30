'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch all customers who have placed orders for this store
      const customers = await knex('customers')
          .join('orders', 'customers.customerId', 'orders.customerId')
          .where('orders.storeId', storeId)
          .groupBy('customers.customerId')
          .select(
              'customers.customerId',
              'customers.fullName',
              'customers.email',
              'customers.phoneNumber',
              knex.raw('COUNT(orders.orderId) as orderCount'),
              knex.raw('SUM(orders.orderTotal) as totalSpent'),
              knex.raw('MAX(orders.orderDate) as lastOrderDate') // Fetch last order date
          );

      if (!customers.length) {
        return reply.status(404).send({ error: 'No customers found for this store.' });
      }

      return reply.send(customers);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customers.' });
    }
  });

}
