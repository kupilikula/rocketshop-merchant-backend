'use strict'
const { v4: uuidv4 } = require("uuid");

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;
    const { collectionName, isActive, storeFrontDisplay, storeFrontDisplayNumberOfItems } = request.body;

    try {
      const collectionId = uuidv4();

      const [newCollection] = await knex("collections")
          .insert({
            collectionId,
            storeId,
            collectionName,
            isActive,
            storeFrontDisplay,
            storeFrontDisplayNumberOfItems,
            displayOrder: 0
          })
          .returning("*"); // Returning inserted row (PostgreSQL)

      return reply.code(201).send({ success: true, data: newCollection });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, message: "Failed to create collection" });
    }
  });
// Utility function to validate merchant's access to the store
}
