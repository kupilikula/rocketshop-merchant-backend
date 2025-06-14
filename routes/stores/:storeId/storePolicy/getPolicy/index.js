// plugins/policiesRoutes.ts

'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    /* GET  /stores/:storeId/policy */
    fastify.get('/', async (req, reply) => {
            const { storeId } = req.params;
            const policy = await knex('storePolicies').where({ storeId }).first();
            return policy || reply.code(404).send({ message: 'Policy not found' });
        }
    );
}