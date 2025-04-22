const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { chatId } = request.params;
        const { merchantId } = request.user;

        if (!merchantId) {
            return reply.status(401).send({ error: 'Unauthorized: Only merchants can access this endpoint.' });
        }

        // Fetch the chat to get the storeId
        const chat = await knex('chats')
            .where({ chatId })
            .first();

        if (!chat) {
            return reply.status(404).send({ error: 'Chat not found.' });
        }

        // Validate merchant-store association and messaging access
        const merchantStore = await knex('merchantStores')
            .where({ merchantId, storeId: chat.storeId })
            .first();

        if (!merchantStore) {
            return reply.status(403).send({ error: 'You are not authorized to access this chat.' });
        }

        if (!merchantStore.canReceiveMessages) {
            return reply.status(403).send({ error: 'Messaging is disabled for your account in this store.' });
        }

        try {
            // Fetch messages with read_at from message_reads for this merchant
            const messages = await knex('messages as m')
                .leftJoin('message_reads as r', function () {
                    this.on('m.messageId', '=', 'r.messageId')
                        .andOn('r.readerId', '=', knex.raw('?', [merchantId]))
                        .andOn('r.readerType', '=', knex.raw('?', ['Merchant']));
                })
                .select(
                    'm.messageId',
                    'm.chatId',
                    'm.senderId',
                    'm.senderType',
                    'm.message',
                    'm.created_at',
                    'm.updated_at',
                    'r.read_at'
                )
                .where('m.chatId', chatId)
                .orderBy('m.created_at', 'asc');

            return reply.send(messages);
        } catch (error) {
            console.error('Error fetching merchant chat messages:', error);
            return reply.status(500).send({ error: 'Failed to fetch chat messages.' });
        }
    });
};