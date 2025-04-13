// routes/stores/updateLogoImage.js

'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeId } = request.params;
        const { logoImageUrl } = request.body;

        if (!storeId || !logoImageUrl) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Update logo
        await knex('stores')
            .where({ storeId })
            .update({
                storeLogoImage: logoImageUrl,
                updated_at: knex.fn.now(),
            });

        return reply.status(200).send({ success: true });
    });
};