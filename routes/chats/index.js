const knex = require('@database/knexInstance');
const {v4: uuidv4} = require("uuid");

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

    fastify.post('/', async (request, reply) => {
        try {
            const { merchantId } = request.user;
            const { customerId, storeId } = request.body;

            // Validate customer exists
            const customer = await knex('customers')
                .where({ customerId })
                .first();

            if (!customer) {
                return reply.status(404).send({ error: 'Customer not found' });
            }

            if (merchantId) {
                if (!storeId) {
                    return reply.status(400).send({ error: 'No storeId specified.' });
                }

                const merchantStore = await knex('merchantStores')
                    .select('storeId', 'canReceiveMessages')
                    .where({ merchantId, storeId })
                    .first();

                if (!merchantStore) {
                    return reply.status(403).send({ error: 'You are not authorized to start chats for this store.' });
                }

                if (!merchantStore.canReceiveMessages) {
                    return reply.status(403).send({ error: 'Messaging is disabled for your account in this store.' });
                }
            }

            // Check if chat already exists
            let chat = await knex('chats')
                .where({ customerId, storeId })
                .first();

            if (!chat) {
                const [newChat] = await knex('chats')
                    .insert({
                        chatId: uuidv4(),
                        customerId,
                        storeId,
                        created_at: new Date(),
                        updated_at: new Date(),
                    })
                    .returning(['chatId', 'storeId', 'customerId', 'updated_at']);

                chat = newChat;
            }

            return reply.send(chat);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to initiate chat' });
        }
    });
};