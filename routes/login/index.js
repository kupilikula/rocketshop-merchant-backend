'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        let i = request.body.storeIndex || 0;
        let row = await knex('merchantStores')
            .select('merchantId', 'storeId')
            .offset(i)
            .first(); // Get a single row directly

        if (!row) {
            throw new Error('No row found at the specified index');
        }

// Extract merchantId and storeId from the row
        const { merchantId, storeId } = row;

// Get the full merchant and store rows
        let [merchant, store] = await Promise.all([
            knex('merchants').where({ merchantId }).first(),
            knex('stores').where({ storeId }).first(),
        ]);
        let result = { merchant, store };

        reply.status(200).send(result);
    });
}
