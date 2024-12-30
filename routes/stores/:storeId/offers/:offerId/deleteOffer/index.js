'use strict'

const knex = require("knex");
const validateMerchantAccessToStore = require("../../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.delete('/api/merchants/stores/:storeId/offers/:offerId', async (request, reply) => {
    const { storeId, offerId } = request.params;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Check if the offer exists
      const offer = await knex('offers')
          .where({ storeId, offerId })
          .first();

      if (!offer) {
        return reply.status(404).send({ error: 'Offer not found.' });
      }

      // Delete the offer
      await knex('offers')
          .where({ storeId, offerId })
          .del();

      return reply.send({ message: 'Offer deleted successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete offer.' });
    }
  });

}
