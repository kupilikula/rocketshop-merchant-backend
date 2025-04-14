'use strict'

const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {

        const { storeId, storeName, storeHandle, storeDescription, storeTags, storeSettings } = request.body;
        const merchantId = request.user.merchantId; // From token payload

        if (!storeName || !storeHandle || !storeDescription || !storeSettings) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        const { defaultGstRate, defaultGstInclusive } = storeSettings;
        if (defaultGstRate === undefined || defaultGstInclusive === undefined) {
            return reply.status(400).send({ error: 'Missing GST settings' });
        }

        // Check if storeId or storeHandle already exists
        const existingStore = await knex('stores')
            .where('storeId', storeId)
            .orWhere('storeHandle', storeHandle)
            .first();

        if (existingStore) {
            return reply.status(400).send({ error: 'Store with this ID or Handle already exists' });
        }

        // Create store
        const [store] = await knex('stores')
            .insert({
                storeId,
                storeName,
                storeHandle,
                storeDescription,
                storeLogoImage: null,
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
                merchantRole: 'Admin',
                canReceiveMessages: true,
                created_at: knex.fn.now(),
            });

        // Insert default GST settings
        await knex('storeSettings')
            .insert({
                storeId,
                defaultGstRate,
                defaultGstInclusive,
                created_at: knex.fn.now(),
            });

        return reply.status(200).send({
            store
        });
    });
}