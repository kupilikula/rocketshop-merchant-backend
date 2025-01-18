'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Fetch customers and their orders in a single query
      const customerOrders = await knex('customers')
          .join('orders', 'customers.customerId', 'orders.customerId')
          .where('orders.storeId', storeId)
          .select(
              'customers.*',
              'orders.orderId',
              'orders.orderStatus',
              'orders.orderStatusUpdateTime',
              knex.raw('CAST("orders"."orderTotal" AS DOUBLE PRECISION) as "orderTotal"'),
              'orders.orderDate'
          )
          .orderBy('orders.orderDate', 'desc'); // Orders sorted by order date

      console.log('customerOrders:', customerOrders);

      if (!customerOrders.length) {
        return reply.status(404).send({ error: 'No customers found for this store.' });
      }

      // Group orders by customerId
      const groupedData = customerOrders.reduce((result, row) => {
        const { orderId, orderStatus, orderStatusUpdateTime, orderTotal, orderDate, ...customerDetails } = row;

        if (!result[row.customerId]) {
          result[row.customerId] = {
            ...customerDetails,
            orders: [],
          };
        }

        result[row.customerId].orders.push({
          orderId,
          orderStatus,
          orderStatusUpdateTime,
          orderTotal,
          orderDate,
        });

        return result;
      }, {});

      // Convert grouped data back to an array
      const customersWithOrders = Object.values(groupedData);

      return reply.send(customersWithOrders);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch customers.' });
    }
  });
};