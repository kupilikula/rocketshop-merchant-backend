const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/:chatId', async (request, reply) => {
        const { chatId } = request.params;
        const { merchantId } = request.user;

        // Fetch the chat to get the storeId
        const chat = await knex('chats')
            .where({ chatId })
            .first();

        if (!chat) {
            return reply.status(404).send({ error: 'Chat not found' });
        }

        // Merchant-specific protection
        if (merchantId) {
            const merchantStore = await knex('merchantStores')
                .where({ merchantId, storeId: chat.storeId })
                .first();

            if (!merchantStore) {
                return reply.status(403).send({ error: 'You are not authorized to access this chat.' });
            }

            if (!merchantStore.canReceiveMessages) {
                return reply.status(403).send({ error: 'Messaging is disabled for your account in this store.' });
            }
        }

        // Fetch messages from the database
        const messages = await knex('messages')
            .where({ chatId })
            .orderBy('created_at', 'asc');

        return reply.send(messages);
    });
};