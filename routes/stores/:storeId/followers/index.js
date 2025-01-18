'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;
    const merchantId = request.user.merchantId; // Assuming authentication middleware adds this

    try {
      // Fetch followers of the store
      const followers = await knex('customer_followed_stores as cfs')
          .select('c.customerId', 'c.fullName', 'c.customerHandle', 'cfs.followed_at')
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
