// plugins/policiesRoutes.ts

const knex = require('@database/knexInstance');

export default async function changePolicy(fastify) {
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