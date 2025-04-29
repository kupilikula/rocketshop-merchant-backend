'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId, groupingEnabled } = request.query;

        const rules = await knex('shipping_rules')
            .where('storeId', storeId)
            .andWhere('groupingEnabled', groupingEnabled==='true')
            .andWhere('isActive', true)
            .select('*')
            .orderBy('created_at', 'desc');

        reply.send(rules);
    });
};