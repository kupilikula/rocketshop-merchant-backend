const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const { storeId } = request.params;
        const { phone, merchantRole } = request.body;

        if (!phone || !merchantRole) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        const merchant = await knex('merchants').where({ phone }).first();

        if (!merchant) {
            return reply.status(404).send({ error: 'Merchant not found' });
        }

        const existing = await knex('merchantStores')
            .where({ storeId, merchantId: merchant.merchantId })
            .first();

        if (existing) {
            return reply.status(400).send({ error: 'Merchant already in store' });
        }

        await knex('merchantStores').insert({
            merchantStoreId: uuidv4(),
            storeId,
            merchantId: merchant.merchantId,
            role: merchantRole,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
        });

        return reply.status(200).send({ success: true });
    });
};