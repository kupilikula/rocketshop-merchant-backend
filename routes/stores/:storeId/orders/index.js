'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;
    const { startDate, endDate, status, limit = 50, offset = 0 } = request.query;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Construct the query
      let query = knex('orders')
          .select(
              'orders.*',
              'customers.customerId',
              'customers.fullName',
              'customers.phone',
              'customers.email',
              'customers.customerAddress'
          )
          .where({ 'orders.storeId': storeId })
          .join('customers', 'orders.customerId', 'customers.customerId');

      if (startDate) {
        query = query.andWhere('orderDate', '>=', new Date(startDate));
      }

      if (endDate) {
        query = query.andWhere('orderDate', '<=', new Date(endDate));
      }

      if (status) {
        query = query.andWhere({ orderStatus: status });
      }

      const orders = await query
          .orderBy('orderDate', 'desc') // Default sorting by order date
          .limit(parseInt(limit))
          .offset(parseInt(offset));

      // Map customer details into the order object
      const formattedOrders = orders.map((order) => ({
        ...order,
        customer: {
          customerId: order.customerId,
          fullName: order.fullName,
          phone: order.phone,
          email: order.email,
          customerAddress: order.customerAddress,
        },
      }));

      // Remove redundant customer fields from the main order object
      formattedOrders.forEach((order) => {
        delete order.customerId;
        delete order.fullName;
        delete order.phone;
        delete order.email;
        delete order.customerAddress;
      });

      return reply.send(formattedOrders);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch orders.' });
    }
  });

}
