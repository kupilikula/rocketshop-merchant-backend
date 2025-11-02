// src/routes/stores/:storeId/getStoreSettings.js

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;

        const settings = await knex('storeSettings')
            .where({ storeId })
            .first();

        if (!settings) {
            return reply.status(404).send({ error: 'Store Settings not found' });
        }

        return reply.send({ settings });
    });
};