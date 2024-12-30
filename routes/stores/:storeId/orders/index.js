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
      let query = knex('orders').where({ storeId });

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

      return reply.send(orders);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch orders.' });
    }
  });

}
