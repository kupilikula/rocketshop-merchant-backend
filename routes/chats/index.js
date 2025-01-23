const knex = require('@database/knexInstance'); // Adjust the path to your DB instance

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        try {
            const { customerId, merchantId } = request.user; // Extract customerId or merchantId from authenticated user
            const { storeId } = request.query; // Extract storeId from query params
            console.log('line8, customerId:', customerId, ' , merchantId:', merchantId, ' , storeId:', storeId);
            // Handle request for customers
            if (customerId) {
                const chats = await knex('chats')
                    .select(
                        'chats.chatId',
                        'chats.storeId',
                        'stores.storeName as recipientName',
                        'chats.updated_at as lastMessageTime',
                        knex('messages')
                            .select('message')
                            .whereRaw('messages.chatId = chats.chatId')
                            .orderBy('messages.created_at', 'desc')
                            .limit(1)
                            .as('lastMessage')
                    )
                    .join('stores', 'chats.storeId', 'stores.storeId')
                    .where({ 'chats.customerId': customerId })
                    .orderBy('chats.updated_at', 'desc');

                return reply.send(chats);
            }

            // Handle request for merchants
            if (merchantId) {
                if (!storeId) {
                    return reply.status(400).send({error: 'No storeId specified.'})
                }

                // Validate that the merchant is associated with the provided storeId
                const store = await knex('merchantStores')
                    .select('storeId')
                    .where({ merchantId, storeId })
                    .first();

                if (!store) {
                    return reply.status(403).send({ error: 'You are not authorized to access chats for this store.' });
                }

                // Fetch all chats for the specified store
                const chats = await knex('chats')
                    .select(
                        'chats.chatId',
                        'chats.customerId',
                        'customers.fullName as recipientName',
                        'customers.customerHandle',
                        'chats.updated_at as lastMessageTime',
                        knex('messages')
                            .select('message')
                            .whereRaw('messages.chatId = chats.chatId')
                            .orderBy('messages.created_at', 'desc')
                            .limit(1)
                            .as('lastMessage')
                    )
                    .join('customers', 'chats.customerId', 'customers.customerId')
                    .where({ 'chats.storeId': storeId })
                    .orderBy('chats.updated_at', 'desc');

                return reply.send(chats);
            }

            // If neither customerId nor merchantId is provided
            return reply.status(400).send({ error: 'Invalid request: No customerId or merchantId found.' });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch chats' });
        }
    });
};
