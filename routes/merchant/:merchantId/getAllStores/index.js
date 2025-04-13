// src/routes/merchant/myStores/index.js

'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async function (request, reply) {
        const merchantId = request.user.merchantId;

        const stores = await knex('stores')
            .join('merchantStores', 'stores.storeId', 'merchantStores.storeId')
            .where('merchantStores.merchantId', merchantId)
            .select('stores.*');

        return reply.send(stores);
    });
}