const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { chatId } = request.params;

        // Extract user information from the request (assumes authenticated user)
        const { customerId, merchantId } = request.user || {};

        // Check if the user is authorized to access the chat
        const isAuthorized = await verifyChatAccess(chatId, customerId, merchantId);

        if (!isAuthorized) {
            return reply.status(403).send({ error: 'You are not authorized to access this chat' });
        }

        // Fetch messages from the database
        const messages = await knex('messages')
            .where({ chatId })
            .orderBy('created_at', 'asc');

        return reply.send(messages);
    });
};

/**
 * Verifies if a user is authorized to access a specific chat.
 * @param {string} chatId - The ID of the chat.
 * @param {string|null} customerId - The customer ID from the request (if applicable).
 * @param {string|null} merchantId - The merchant ID from the request (if applicable).
 * @returns {Promise<boolean>} - True if the user is authorized, false otherwise.
 */
async function verifyChatAccess(chatId, customerId, merchantId) {
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
}