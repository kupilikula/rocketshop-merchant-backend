'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch all collections for the store
      const collections = await knex('collections')
          .where({ storeId })
          .orderBy('displayOrder', 'asc'); // Fetch all fields and order by displayOrder

      if (!collections.length) {
        return reply.status(404).send({ error: 'No collections found for this store.' });
      }

      return reply.send(collections);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch collections.' });
    }
  });

}
