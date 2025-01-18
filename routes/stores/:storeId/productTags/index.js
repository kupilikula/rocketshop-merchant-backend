'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // Fetch all products for the store, selecting all fields
      const uniqueTags = await knex('products')
          .where({storeId})
          .select(knex.raw('DISTINCT jsonb_array_elements_text("productTags") AS tag'));
      const uniqueTagsArray = uniqueTags.map(row => row.tag);
      console.log(uniqueTagsArray);

      return reply.send(uniqueTagsArray);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch productTags for the store.' });
    }
  });

}
