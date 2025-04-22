'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const merchantId = request.user?.merchantId;

        if (!merchantId) {
            return reply.status(401).send({ error: 'Unauthorized: Merchant not logged in.' });
        }

        try {
            // Verify that the merchant has access to this store and messaging is enabled
            const merchantStore = await knex('merchantStores')
                .where({ merchantId, storeId })
                .first();

            if (!merchantStore) {
                return reply.status(403).send({ error: 'You are not authorized for this store.' });
            }

            if (!merchantStore.canReceiveMessages) {
                return reply.status(403).send({ error: 'Messaging is disabled for your account in this store.' });
            }

            // Fetch unread messages sent by customers in chats of this store
            const unreadMessages = await knex('messages as m')
                .join('chats as c', 'm.chatId', 'c.chatId')
                .leftJoin('message_reads as r', function () {
                    this.on('m.messageId', '=', 'r.messageId')
                        .andOn('r.readerId', '=', knex.raw('?', [merchantId]))
                        .andOn('r.readerType', '=', knex.raw('?', ['Merchant']));
                })
                .where('c.storeId', storeId)
                .andWhere('m.senderType', 'Customer') // Only customer-sent messages
                .whereNull('r.read_at')            // Not read by this merchant
                .select(
                    'm.messageId',
                    'm.chatId',
                    'm.senderId',
                    'm.message',
                    'm.created_at'
                );

            // Group unread messages by chatId
            const unreadMessagesByChat = {};
            for (const msg of unreadMessages) {
                if (!unreadMessagesByChat[msg.chatId]) {
                    unreadMessagesByChat[msg.chatId] = [];
                }
                unreadMessagesByChat[msg.chatId].push({
                    messageId: msg.messageId,
                    senderId: msg.senderId,
                    message: msg.message,
                    created_at: msg.created_at,
                });
            }

            const unreadCounts = Object.fromEntries(
                Object.entries(unreadMessagesByChat).map(([chatId, messages]) => [
                    chatId,
                    messages.length,
                ])
            );

            return reply.send({
                unreadCounts,
                unreadMessages: unreadMessagesByChat,
            });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch unread messages.' });
        }
    });
};