const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        try {
            const { merchantId } = request.user;
            const { storeId } = request.query;

            if (merchantId) {
                if (!storeId) {
                    return reply.status(400).send({ error: 'No storeId specified.' });
                }

                // Fetch merchant store association
                const merchantStore = await knex('merchantStores')
                    .select('storeId', 'canReceiveMessages')
                    .where({ merchantId, storeId })
                    .first();

                if (!merchantStore) {
                    return reply.status(403).send({ error: 'You are not authorized to access chats for this store.' });
                }

                if (!merchantStore.canReceiveMessages) {
                    return reply.status(403).send({ error: 'Messaging is disabled for your account in this store.' });
                }

                // Fetch chats
                const chats = await knex('chats')
                    .select(
                        'chats.chatId',
                        'chats.customerId',
                        'customers.fullName as customerName',
                        'customers.phone as customerPhone',
                        'customers.customerHandle',
                        'chats.updated_at as lastMessageTime',
                        knex('messages')
                            .select('message')
                            .whereRaw('messages."chatId" = chats."chatId"')
                            .orderBy('messages.created_at', 'desc')
                            .limit(1)
                            .as('lastMessage')
                    )
                    .join('customers', 'chats.customerId', 'customers.customerId')
                    .where({ 'chats.storeId': storeId })
                    .orderBy('chats.updated_at', 'desc');

                return reply.send(chats);
            }

            return reply.status(400).send({ error: 'Invalid request: No merchantId found.' });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch chats' });
        }
    });
};