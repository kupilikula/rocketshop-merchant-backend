'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Validate the merchant's access to the store (optional, based on your auth system)
      const merchantId = request.user.merchantId; // Assumes user data is attached to the request
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Fetch all products for the store, selecting all fields
      const uniqueTags = await knex('products')
          .select(knex.raw('DISTINCT jsonb_array_elements_text("productTags") AS tag'));
      const uniqueTagsArray = uniqueTags.map(row => row.tag);
      console.log(uniqueTagsArray);

      return reply.send(uniqueTags);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch productTags for the store.' });
    }
  });

}
