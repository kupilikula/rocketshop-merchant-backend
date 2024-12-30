'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
  fastify.post('/api/merchants/stores/:storeId/offers', async (request, reply) => {
    const { storeId } = request.params;
    const {
      offerName,
      description,
      offerCode,
      requireCode = false,
      offerType,
      discountDetails,
      applicableTo,
      conditions,
      validityDateRange,
      isActive = true,
    } = request.body;

    try {
      // Validate the merchant's access to the store
      const merchantId = request.user.merchantId;
      const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Unauthorized access to this store.' });
      }

      // Input validation
      if (!offerName || !offerType || !validityDateRange || !discountDetails) {
        return reply.status(400).send({ error: 'Missing required offer fields.' });
      }

      // Insert the new offer into the database
      const [newOfferId] = await knex('offers')
          .insert({
            storeId,
            offerName,
            description,
            offerCode,
            requireCode,
            offerType,
            discountDetails: JSON.stringify(discountDetails),
            applicableTo: JSON.stringify(applicableTo),
            conditions: JSON.stringify(conditions),
            validityDateRange: JSON.stringify(validityDateRange),
            isActive,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('offerId');

      return reply.send({
        message: 'Offer created successfully.',
        offerId: newOfferId,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to create offer.' });
    }
  });

}
