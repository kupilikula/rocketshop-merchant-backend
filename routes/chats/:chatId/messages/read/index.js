const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require("uuid");

module.exports = async function (fastify, opts) {
    fastify.patch("/", async (request, reply) => {
        const { chatId } = request.params;
        const { messageIds } = request.body; // Array of message IDs

        const userId = request.user.merchantId; // Use merchantId for merchants
        const userType = "Merchant";

        try {
            console.log("req.user:", request.user);

            // Fetch the chat to get storeId
            const chat = await knex("chats").where({ chatId }).first();
            if (!chat) {
                return reply.status(404).send({ error: "Chat not found." });
            }

            // Verify merchant association and canReceiveMessages
            const merchantStore = await knex("merchantStores")
                .where({ merchantId: userId, storeId: chat.storeId })
                .first();

            if (!merchantStore) {
                return reply.status(403).send({ error: "You are not authorized for this store." });
            }

            if (!merchantStore.canReceiveMessages) {
                return reply.status(403).send({ error: "Messaging is disabled for your account in this store." });
            }

            // Insert new read records into the message_reads table
            const readRecords = messageIds.map((messageId) => ({
                messageReadId: uuidv4(),
                messageId,
                readerId: userId,
                readerType: userType,
                read_at: new Date(),
            }));

            await knex("message_reads")
                .insert(readRecords)
                .onConflict(["messageId", "readerId"])
                .merge({ read_at: new Date() });

            reply.send({ success: true });
        } catch (error) {
            console.error("Error marking messages as read:", error);
            reply.status(500).send({ error: "Failed to mark messages as read." });
        }
    });
};