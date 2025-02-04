'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.patch('/', async (request, reply) => {
    const { storeId, offerId } = request.params;
    const {
      offerName,
      offerDescription,
      // offerCode,
      // requireCode,
      offerType,
      discountDetails,
      applicableTo,
      conditions,
      validityDateRange,
      isActive,
    } = request.body;

    try {
      // Check if the offer exists
      const offer = await knex('offers')
          .where({ storeId, offerId })
          .first();

      if (!offer) {
        return reply.status(404).send({ error: 'Offer not found.' });
      }

      // Prepare update object
      const updateFields = {};
      if (offerName) updateFields.offerName = offerName;
      if (offerDescription) updateFields.offerDescription = offerDescription;
      // if (offerCode !== undefined) updateFields.offerCode = offerCode;
      // if (requireCode !== undefined) updateFields.requireCode = requireCode;
      if (offerType) updateFields.offerType = offerType;
      if (discountDetails) updateFields.discountDetails = JSON.stringify(discountDetails);
      if (applicableTo) updateFields.applicableTo = JSON.stringify(applicableTo);
      if (conditions) updateFields.conditions = JSON.stringify(conditions);
      if (validityDateRange) updateFields.validityDateRange = JSON.stringify(validityDateRange);
      if (isActive !== undefined) updateFields.isActive = isActive;

      // Update the offer in the database
      await knex('offers')
          .where({ storeId, offerId })
          .update({
            ...updateFields,
            updated_at: new Date(), // Update the timestamp
          });

      return reply.send({ message: 'Offer updated successfully.' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to update offer.' });
    }
  });

}
