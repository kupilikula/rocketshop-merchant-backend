'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId, customerId } = request.params;
    const { page = 1, limit = 20 } = request.query;

    const offset = (page - 1) * limit;

    const orders = await knex('orders')
        .where({ storeId, customerId })
        .orderBy('orderDate', 'desc')
        .limit(limit)
        .offset(offset);

    const totalCount = await knex('orders')
        .where({ storeId, customerId })
        .count('orderId as count')
        .first();

    return reply.send({
      orders,
      pagination: {
        total: Number(totalCount.count),
        page: Number(page),
        limit: Number(limit),
        hasMore: offset + orders.length < Number(totalCount.count),
      },
    });
  });
};