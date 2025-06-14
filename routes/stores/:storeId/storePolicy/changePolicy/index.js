// plugins/policiesRoutes.ts

'use strict';
const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (req, reply) => {
            const { storeId } = req.params;
            const data = { ...req.body, updatedAt: knex.fn.now() };

            const exists = await knex('storePolicies').where({ storeId }).first();
            if (exists) {
                await knex('storePolicies').where({ storeId }).update(data);
            } else {
                await knex('storePolicies').insert({ ...data, storeId });
            }
            return { success: true };
        }
    );
}