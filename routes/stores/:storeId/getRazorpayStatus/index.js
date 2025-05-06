// src/routes/stores/razorpayConnection.js
'use strict';

const knex = require('@database/knexInstance'); // <<< ADJUST path to your Knex instance

module.exports = async function (fastify, opts) {

    // GET /stores/:storeId/razorpay-connection
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const merchantId = request.user?.merchantId; // Get authenticated merchant ID
        const logger = fastify.log;

        try {
            // 2. Fetch Connection Status and Account ID using LEFT JOINs
            // This query works whether the store is linked or not.
            logger.info({ storeId }, 'Fetching Razorpay connection status for store.');

            const connectionDetails = await knex('stores as s')
                .leftJoin('store_razorpay_links as srl', 's.storeId', 'srl.storeId')
                .leftJoin('razorpay_credentials as rc', 'srl.razorpayCredentialId', 'rc.credentialId')
                .select(
                    // Determine connection status based on whether a link and credential exist
                    knex.raw('CASE WHEN srl."linkId" IS NOT NULL AND rc."credentialId" IS NOT NULL THEN ? ELSE ? END as "isConnected"', [true, false]),
                    // Select the Razorpay Account ID if connected
                    'rc.razorpayAccountId'
                )
                .where('s.storeId', storeId)
                .first(); // We expect exactly one result for a valid storeId

            if (!connectionDetails) {
                // This case means the storeId itself doesn't exist, which shouldn't happen
                // if the merchantStores check passed, but handle defensively.
                logger.error({ storeId }, 'Store not found after passing authorization check.');
                return reply.status(404).send({ error: 'Store not found.' });
            }

            logger.info({ storeId, ...connectionDetails }, 'Successfully fetched Razorpay connection status.');

            // 3. Return the result
            return reply.send(connectionDetails);

        } catch (error) {
            logger.error({ err: error, storeId, merchantId }, 'Error fetching Razorpay connection status.');
            return reply.status(500).send({ error: 'Internal Server Error fetching connection status.' });
        }
    });
};