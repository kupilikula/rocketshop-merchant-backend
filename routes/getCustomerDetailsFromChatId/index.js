'use strict'

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { chatId } = request.query;

        try {
            const customer = await knex('chats')
                .join('customers', 'chats.customerId', '=', 'customers.customerId')
                .where('chats.chatId', chatId)
                .select('customers.customerId', 'customers.fullName')
                .first();

            if (!store) {
                return reply.status(404).send({ error: 'Customer not found' });
            }

            return reply.send( customer);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};