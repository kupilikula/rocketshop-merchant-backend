'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeName } = request.query;

        if (!storeName) {
            return reply.status(400).send({ error: 'storeName is required' });
        }

        const baseHandle = storeName
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, '') // Remove special chars
            .trim()
            .replace(/\s+/g, ''); // Replace spaces with -

        let handle = baseHandle;
        let suffix = 1;

        while (true) {
            const existing = await knex('stores')
                .where('storeHandle', handle)
                .first();

            if (!existing) {
                break;
            }

            handle = `${baseHandle}${suffix}`;
            suffix++;
        }

        return reply.status(200).send({ storeHandle: handle });
    });
}