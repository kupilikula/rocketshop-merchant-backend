const knex = require("@database/knexInstance");
const {v4: uuidv4} = require("uuid");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const requestingMerchantId = request.user.merchantId; // From JWT

        // Check if requesting merchant is associated with store
        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant) {
            return reply.status(403).send({ error: 'Access denied' });
        }

        // Only allow Admin or Manager to fetch merchants list
        if (!['Owner','Admin', 'Manager'].includes(requestingMerchant.merchantRole)) {
            return reply.status(403).send({ error: 'Only Owner, Admin or Manager can view store merchants' });
        }

        // Fetch merchants
        const merchants = await knex('merchantStores')
            .join('merchants', 'merchantStores.merchantId', 'merchants.merchantId')
            .where('merchantStores.storeId', storeId)
            .select(
                'merchants.*',
                'merchantStores.merchantRole',
                'merchantStores.canReceiveMessages'
            );

        return reply.send({ merchants });
    });

    fastify.post('/', async (request, reply) => {
        const { storeId } = request.params;
        const { phone, fullName, merchantRole, canReceiveMessages } = request.body;
        const requestingMerchantId = request.user.merchantId;

        if (!phone || !merchantRole || !canReceiveMessages || !fullName) {
            return reply.status(400).send({ error: "Missing phone, merchantRole, fullName or canReceiveMessages" });
        }

        if (!['Owner','Admin', 'Manager', 'Staff'].includes(merchantRole)) {
            return reply.status(400).send({ error: "Invalid merchantRole" });
        }

        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!requestingMerchant || !['Owner', 'Admin', 'Manager'].includes(requestingMerchant.merchantRole)) {
            return reply.status(403).send({ error: "Only Owner, Admin or Manager roles can add merchants" });
        }

        // Restrict Admin from adding Owner
        if (requestingMerchant.merchantRole === 'Admin' && merchantRole === 'Owner') {
            return reply.status(403).send({ error: "Admins can only add Admin, Staff or Manager roles" });
        }

        // Restrict Manager from adding Admins or Owners
        if (requestingMerchant.merchantRole === 'Manager' && ['Owner','Admin'].includes(merchantRole)) {
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

        // Insert merchant-store association and default notification preferences inside a transaction
        await knex.transaction(async (trx) => {
            // Insert into merchantStores
            await trx('merchantStores').insert({
                merchantStoreId: uuidv4(),
                storeId,
                merchantId: merchant.merchantId,
                merchantRole,
                canReceiveMessages,
                created_at: knex.fn.now()
            });

            // Insert default notification preferences
            await trx('merchantNotificationPreferences').insert({
                merchantId: merchant.merchantId,
                storeId,
                muteAll: false,
                newOrders: true,
                chatMessages: true,
                returnRequests: true,
                orderCancellations: true,
                miscellaneous: true,
                ratingsAndReviews: true,
                newFollowers: true,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
        });

        return reply.status(200).send({ success: true });
    });
};