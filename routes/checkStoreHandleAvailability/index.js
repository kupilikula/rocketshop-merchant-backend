'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeHandle } = request.body;

        if (!storeHandle) {
            return reply.status(400).send({ error: 'storeHandle is required' });
        }

        const existing = await knex('stores')
            .where('storeHandle', storeHandle)
            .first();

        return reply.status(200).send({
            available: !existing
        });
    });
}