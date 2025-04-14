// src/routes/stores/:storeId/updateGstSettings.js

'use strict';

const knex = require("@database/knexInstance");
const GST_RATES = [0, 5, 12, 18, 28];

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {
        const { storeId } = request.params;
        const { defaultGstInclusive, defaultGstRate } = request.body;
        const merchantId = request.user.merchantId;

        // Fetch requesting merchant's role
        const requestingMerchant = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!requestingMerchant || requestingMerchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can update GST settings.' });
        }

        if (defaultGstRate !== undefined && !GST_RATES.includes(defaultGstRate)) {
            return reply.status(400).send({ error: 'Invalid GST Rate' });
        }

        const updateData = {};

        if (defaultGstInclusive !== undefined) updateData.defaultGstInclusive = defaultGstInclusive;
        if (defaultGstRate !== undefined) updateData.defaultGstRate = defaultGstRate;

        if (Object.keys(updateData).length === 0) {
            return reply.status(400).send({ error: 'No valid fields provided for update' });
        }

        await knex('storeSettings')
            .where({ storeId })
            .update({
                ...updateData,
                updated_at: knex.fn.now(),
            });

        return reply.status(200).send({ success: true });
    });
}