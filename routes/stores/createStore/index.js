'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {

        const { storeName, storeHandle, storeDescription, storeLogoImage, storeBrandColor, storeTags } = request.body;
        const merchantId = request.user.merchantId; // From token payload

        if (!storeName || !storeHandle || !storeDescription) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        // Optional: Check if storeHandle is taken
        const existingStore = await knex('stores')
            .where({ storeHandle })
            .first();

        if (existingStore) {
            return reply.status(400).send({ error: 'Store handle already taken' });
        }

        // Create store
        const storeId = uuidv4();

        const [store] = await knex('stores')
            .insert({
                storeId,
                storeName,
                storeHandle,
                storeDescription,
                storeLogoImage: storeLogoImage || null,
                storeBrandColor: storeBrandColor || null,
                storeTags: JSON.stringify(storeTags || []),
                created_at: knex.fn.now(),
            })
            .returning('*');

        if (!store) {
            return reply.status(500).send({ error: 'Failed to create store' });
        }

        // Associate merchant with store as Admin
        await knex('merchantStores')
            .insert({
                merchantStoreId: uuidv4(),
                merchantId,
                storeId,
                role: 'Admin',
                canReceiveMessages: true,
                created_at: knex.fn.now(),
            });

        return reply.status(200).send({
            store
        });
    });
}