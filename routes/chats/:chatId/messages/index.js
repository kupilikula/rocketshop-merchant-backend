const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get("/", async (request, reply) => {
        const { chatId } = request.params;
        const { merchantId } = request.user;

        if (!merchantId) {
            return reply.status(401).send({ error: "Unauthorized: Only merchants can access this endpoint." });
        }

        const chat = await knex("chats").where({ chatId }).first();

        if (!chat) {
            return reply.status(404).send({ error: "Chat not found." });
        }

        const merchantStore = await knex("merchantStores")
            .where({ merchantId, storeId: chat.storeId })
            .first();

        if (!merchantStore) {
            return reply.status(403).send({ error: "You are not authorized to access this chat." });
        }

        if (!merchantStore.canReceiveMessages) {
            return reply.status(403).send({ error: "Messaging is disabled for your account in this store." });
        }

        try {
            const messages = await knex("messages as m")
                .leftJoin("message_reads as r", function () {
                    this.on("m.messageId", "=", "r.messageId")
                        .andOn("r.readerId", "=", knex.raw("?", [chat.customerId]))
                        .andOn("r.readerType", "=", knex.raw("?", ["Customer"]));
                })
                .select(
                    "m.messageId",
                    "m.chatId",
                    "m.senderId",
                    "m.senderType",
                    "m.message",
                    "m.created_at",
                    "m.updated_at",
                    "r.read_at"
                )
                .where("m.chatId", chatId)
                .orderBy("m.created_at", "asc");

            return reply.send(messages);
        } catch (error) {
            console.error("Error fetching merchant chat messages:", error);
            return reply.status(500).send({ error: "Failed to fetch chat messages." });
        }
    });

    fastify.post('/', async (request, reply) => {
        const { chatId } = request.params;
        const { messageId, senderId, senderType, message, created_at } = request.body;

        if (!messageId || !chatId || !senderId || !senderType || !message) {
            return reply.code(400).send({ error: 'Missing required fields' });
        }

        try {
            // Check if message already exists
            const existingMessage = await knex('messages')
                .where({ messageId })
                .first();

            if (existingMessage) {
                // Message already saved — safe to treat as success
                return reply.code(200).send({ status: 'duplicate', messageId });
            }

            // Save new message
            await knex('messages').insert({
                messageId,
                chatId,
                senderId,
                senderType,
                message,
                created_at: created_at ? new Date(created_at) : new Date(),
            });

            return reply.code(201).send({ status: 'created', messageId });
        } catch (error) {
            console.error('Error saving new message via API:', error);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
};