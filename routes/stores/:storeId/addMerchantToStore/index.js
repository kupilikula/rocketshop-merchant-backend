const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const { storeId } = request.params;
        const { phone, fullName, role } = request.body;
        const requestingMerchantId = request.user.merchantId;

        if (!phone || !role) {
            return reply.status(400).send({ error: "Missing phone or role" });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || (requestingMerchant.role !== 'Admin' && requestingMerchant.role !== 'Manager')) {
            return reply.status(403).send({ error: "Only Admin or Manager roles can add merchants" });
        }

        let merchant = await knex('merchants').where({ phone }).first();

        if (!merchant) {
            if (!fullName) {
                return reply.status(400).send({ error: "Full name required for new merchant" });
            }

            const merchantId = uuidv4();
            merchant = await knex('merchants')
                .insert({
                    merchantId,
                    fullName,
                    phone,
                    merchantRole: 'Staff', // default or based on business rule
                    created_at: knex.fn.now()
                })
                .returning('*')
                .then(rows => rows[0]);
        }

        // Check if already associated
        const existingAssociation = await knex('merchantStores')
            .where({ storeId, merchantId: merchant.merchantId })
            .first();

        if (existingAssociation) {
            return reply.status(400).send({ error: "Merchant already part of this store" });
        }

        await knex('merchantStores').insert({
            merchantStoreId: uuidv4(),
            storeId,
            merchantId: merchant.merchantId,
            role,
            created_at: knex.fn.now()
        });

        return reply.status(200).send({ success: true });
    });
};