'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        let i = request.body.storeIndex || 0;
        let {merchantId, storeId} = knex('merchantStores')
            .select('merchantId', 'storeId')
            .offset(i)
            .limit(1);
        console.log('merchantId:', merchantId, ', storeId:', storeId);
        reply.status(200).send({merchantId, storeId});
    });
}
