// plugins/policiesRoutes.ts

const knex = require('@database/knexInstance');

export default async function getPolicy(fastify) {
    /* GET  /stores/:storeId/policy */
    fastify.get('/', async (req, reply) => {
            const { storeId } = req.params;
            const policy = await knex('storePolicies').where({ storeId }).first();
            return policy || reply.code(404).send({ message: 'Policy not found' });
        }
    );
}