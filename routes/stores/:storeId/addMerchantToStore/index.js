const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async (request, reply) => {
        const { storeId } = request.params;
        const { phone, fullName, merchantRole } = request.body;
        const requestingMerchantId = request.user.merchantId;

        if (!phone || !merchantRole) {
            return reply.status(400).send({ error: "Missing phone or merchantRole" });
        }

        if (!['Admin', 'Manager', 'Staff'].includes(merchantRole)) {
            return reply.status(400).send({ error: "Invalid merchantRole" });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || (requestingMerchant.merchantRole !== 'Admin' && requestingMerchant.merchantRole !== 'Manager')) {
            return reply.status(403).send({ error: "Only Admin or Manager roles can add merchants" });
        }

        // Restrict Manager from adding Admins
        if (requestingMerchant.merchantRole === 'Manager' && merchantRole === 'Admin') {
            return reply.status(403).send({ error: "Managers can only add Staff or Manager roles" });
        }

        // Check if merchant exists
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
                    merchantRole: 'Staff', // Global role
                    created_at: knex.fn.now()
                })
                .returning('*')
                .then(rows => rows[0]);
        }

        // Check if already associated with this store
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
            merchantRole,
            created_at: knex.fn.now()
        });

        return reply.status(200).send({ success: true });
    });
};