// plugins/merchantAccessValidator.js
const fp = require('fastify-plugin');
const knex = require('@database/knexInstance');
async function chatAccessValidator(fastify, options) {
    // Middleware logic for validating merchant access
    fastify.decorate('validateChatAccessMiddleware', async function (request, reply) {
        const { chatId } = request.params;

        // Extract user information from the request (assumes authenticated user)
        const { customerId, merchantId } = request.user || {};

        // Check if the user is a customer in this chat
        if (customerId) {
            const customerChat = await knex('chats')
                .where({ chatId, customerId })
                .first();
            if (customerChat) return true;
        }

        // Check if the user is a merchant in this chat (associated with the store)
        if (merchantId) {
            const merchantStore = await knex('merchantStores')
                .join('chats', 'merchantStores.storeId', 'chats.storeId')
                .where({ 'chats.chatId': chatId, 'merchantStores.merchantId': merchantId })
                .first();
            if (merchantStore) return true;
        }

        // If neither condition is met, the user is not authorized
        return false;
    });

    // Hook to automatically apply validation middleware to matching routes
    fastify.addHook('onRoute', (routeOptions) => {
        if (routeOptions.url.startsWith('/chats/:chatId')) {
            // Attach the validation middleware to routes matching the pattern
            routeOptions.preHandler = routeOptions.preHandler || [];
            routeOptions.preHandler = Array.isArray(routeOptions.preHandler)
                ? [...routeOptions.preHandler, fastify.validateChatAccessMiddleware]
                : [routeOptions.preHandler, fastify.validateChatAccessMiddleware];
        }
    });
}

module.exports = fp(chatAccessValidator);