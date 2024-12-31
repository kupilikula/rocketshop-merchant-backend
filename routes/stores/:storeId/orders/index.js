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

      // Construct the main query for orders
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

      // Extract orderIds to fetch order items
      const orderIds = orders.map(order => order.orderId);

      // Fetch order items and associated products
      const orderItemsData = await knex('order_items')
          .select(
              'order_items.orderId',
              'order_items.quantity',
              'products.productId',
              'products.price',
              'products.productName',
              'products.mediaItems'
          )
          .whereIn('order_items.orderId', orderIds)
          .join('products', 'order_items.productId', 'products.productId');

      // Group order items by orderId
      const orderItemsGrouped = orderItemsData.reduce((acc, item) => {
        const { orderId, quantity, ...productDetails } = item;
        if (!acc[orderId]) acc[orderId] = [];
        acc[orderId].push({ product: productDetails, quantity });
        return acc;
      }, {});

      // Map customer details and order items into the order object
      const formattedOrders = orders.map((order) => ({
        ...order,
        customer: {
          customerId: order.customerId,
          fullName: order.fullName,
          phone: order.phone,
          email: order.email,
          customerAddress: order.customerAddress,
        },
        orderItems: orderItemsGrouped[order.orderId] || [],
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
