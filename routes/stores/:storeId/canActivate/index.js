'use strict';

const { checkStoreActivationReadiness } = require('../../../../utils/checkStoreActivationReadiness');
const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async function (request, reply) {
        const { storeId } = request.params;
        const { merchantId } = request.user;

        // Security Check: Ensure the logged-in user is an admin of this store
        const merchant = await knex('merchantStores').where({ storeId, merchantId }).first();
        if (!merchant || !['Owner', 'Admin'].includes(merchant.merchantRole)) {
            return reply.status(403).send({ error: 'You do not have permission to view this store\'s activation status.' });
        }

        const store = await knex('stores').where({ storeId }).first();
        if (!store) { return reply.status(404).send({ error: 'Store not found.' }); }
        if (store.isActive) { return reply.send({ success: true, message: 'Store is already active.' }); }

        // Call the reusable service function to get the status
        const readinessStatus = await checkStoreActivationReadiness({ store });

        // Return the detailed status object to the frontend
        return reply.send(readinessStatus);
    });
};