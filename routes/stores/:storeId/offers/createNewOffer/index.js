'use strict'
const { v4: uuidv4 } = require("uuid");
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const {
      offerName,
      offerDescription,
      offerType,
      discountDetails,
      applicableTo,
      conditions,
      validityDateRange,
      isActive = true,
    } = request.body;

    try {
      // Input validation
      if (!offerName || !offerType || !validityDateRange || !discountDetails) {
        return reply.status(400).send({ error: 'Missing required offer fields.' });
      }

      const offerId = uuidv4();
      // Insert the new offer into the database
      const [newOfferId] = await knex('offers')
          .insert({
              offerId,
            storeId,
            offerName,
            offerDescription,
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
