'use strict';

const knex = require("@database/knexInstance");
const dayjs = require('dayjs');
const {getSalesEligibleOrderStatuses} = require("../../../../utils/orderStatusList");

const eligibleStatuses = getSalesEligibleOrderStatuses();

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // 1. Fetch products
      const products = await knex('products')
          .where({ storeId })
          .orderBy('created_at', 'desc');

      if (!products || products.length === 0) {
        return reply.status(200).send([]);
      }

      const productIds = products.map((p) => p.productId);

      // 2. Define time ranges
      const now = dayjs();
      const timeRanges = {
        day: now.subtract(1, 'day').toISOString(),
        week: now.subtract(1, 'week').toISOString(),
        month: now.subtract(1, 'month').toISOString(),
        year: now.subtract(1, 'year').toISOString(),
      };

      // 3. Fetch order_items joined with orders in one query (filter by storeId + relevant time ranges)
      const orderItems = await knex('order_items')
          .join('orders', 'order_items.orderId', 'orders.orderId')
          .where('orders.storeId', storeId)
          .whereIn('orders.orderStatus', eligibleStatuses)
          .where('orders.orderDate', '>=', timeRanges.year) // only last year data needed
          .whereIn('order_items.productId', productIds)
          .select(
              'order_items.productId',
              'order_items.price',
              'order_items.quantity',
              'orders.orderDate'
          );

      // 4. Group sales by productId and time range
      const salesByProduct = {};

      for (const item of orderItems) {
        const { productId, price, quantity, orderDate } = item;
        const orderTime = dayjs(orderDate);
        const saleAmount = Number(price) * quantity;

        if (!salesByProduct[productId]) {
          salesByProduct[productId] = {
            day: { revenue: 0, count: 0 },
            week: { revenue: 0, count: 0 },
            month: { revenue: 0, count: 0 },
            year: { revenue: 0, count: 0 },
          };
        }

        if (orderTime.isAfter(timeRanges.day)) {
          salesByProduct[productId].day.revenue += saleAmount;
          salesByProduct[productId].day.count += 1;
        }
        if (orderTime.isAfter(timeRanges.week)) {
          salesByProduct[productId].week.revenue += saleAmount;
          salesByProduct[productId].week.count += 1;
        }
        if (orderTime.isAfter(timeRanges.month)) {
          salesByProduct[productId].month.revenue += saleAmount;
          salesByProduct[productId].month.count += 1;
        }
        if (orderTime.isAfter(timeRanges.year)) {
          salesByProduct[productId].year.revenue += saleAmount;
          salesByProduct[productId].year.count += 1;
        }
      }

      // 5. Map collections
      const productCollections = await knex('productCollections')
          .join('collections', 'productCollections.collectionId', 'collections.collectionId')
          .whereIn('productCollections.productId', productIds)
          .select(
              'productCollections.productId',
              'collections.collectionId',
              'collections.collectionName'
          );

      const collectionsByProduct = productCollections.reduce((acc, pc) => {
        if (!acc[pc.productId]) acc[pc.productId] = [];
        acc[pc.productId].push({
          collectionId: pc.collectionId,
          collectionName: pc.collectionName,
        });
        return acc;
      }, {});

      // 6. Attach sales + collections to each product
      const productsWithStats = products.map((product) => {
        const stats = salesByProduct[product.productId] || {
          day: { revenue: 0, count: 0 },
          week: { revenue: 0, count: 0 },
          month: { revenue: 0, count: 0 },
          year: { revenue: 0, count: 0 },
        };

        return {
          ...product,
          collections: collectionsByProduct[product.productId] || [],
          salesStats: stats,
        };
      });

      return reply.send(productsWithStats);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch products for the store.' });
    }
  });
};