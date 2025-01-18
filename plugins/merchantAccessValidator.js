// plugins/merchantAccessValidator.js
const fp = require('fastify-plugin');
const knex = require('@database/knexInstance');
async function merchantAccessValidator(fastify, options) {
    // Middleware logic for validating merchant access
    fastify.decorate('validateMerchantAccessMiddleware', async function (request, reply) {
        const { merchantId } = request.user;
        const { storeId } = request.params;
        console.log('Validating merchant access to store.');
        if (!storeId) {
            return reply.status(400).send({ error: 'Store ID is required.' });
        }

        const store = await knex('merchantStores')
            .where({ storeId, merchantId })
            .first();

        if (!store) {
            return reply.status(403).send({ error: 'Unauthorized access to this store.' });
        }
    });

    // Hook to automatically apply validation middleware to matching routes
    fastify.addHook('onRoute', (routeOptions) => {
        if (routeOptions.url.startsWith('/stores/:storeId')) {
            // Attach the validation middleware to routes matching the pattern
            routeOptions.preHandler = routeOptions.preHandler || [];
            routeOptions.preHandler = Array.isArray(routeOptions.preHandler)
                ? [...routeOptions.preHandler, fastify.validateMerchantAccessMiddleware]
                : [routeOptions.preHandler, fastify.validateMerchantAccessMiddleware];
        }
    });
}

module.exports = fp(merchantAccessValidator);