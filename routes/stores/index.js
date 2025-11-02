'use strict';

const knex = require('@database/knexInstance');
const { v4: uuidv4 } = require('uuid');

// -----------------------------------------------------------------------------
// Helper – quick numeric range validator
// -----------------------------------------------------------------------------
const inRange = (val, min, max) =>
    typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const logger = fastify.log;
        const {
            storeId,
            storeName,
            storeHandle,
            storeDescription,
            storeTags,
            storeSettings,            // { defaultGstRate, defaultGstInclusive }
            storePolicy,              //  <<< NEW — validated below
            storeEmail,
            storePhone,
            category,
            subcategory,
            isPlatformOwned,
        } = request.body;

        const merchantId = request.user.merchantId;

        /* ------------------------------------------------------------------ */
        /* 1. Basic field presence checks (existing)                          */
        /* ------------------------------------------------------------------ */
        if (
            !storeId ||
            !storeName ||
            !storeHandle ||
            !storeDescription ||
            !storeSettings ||
            !storePolicy ||
            !storeEmail ||
            !storePhone ||
            !category
        ) {
            return reply
                .status(400)
                .send({ error: 'Missing required store or business detail fields' });
        }

        const { defaultGstRate, defaultGstInclusive } = storeSettings || {};
        if (
            defaultGstRate === undefined ||
            defaultGstRate === null ||
            defaultGstInclusive === undefined
        ) {
            return reply
                .status(400)
                .send({ error: 'Missing or invalid GST settings.' });
        }

        /* ------------------------------------------------------------------ */
        /* 2. Validate Store Policy parameters                                */
        /* ------------------------------------------------------------------ */
        const policyErr = msg =>
            reply
                .status(400)
                .send({ error: `Invalid storePolicy: ${msg}` });

        if (!storePolicy) {
            return policyErr('object is required');
        }

        const {
            handlingTimeDays,
            cancellationWindowHours,
            returnsAccepted,
            returnWindowDays,
            refundProcessingTimeDays,
        } = storePolicy;

        if (!inRange(handlingTimeDays, 0, 30))
            return policyErr('handlingTimeDays must be 0-30');

        if (!inRange(cancellationWindowHours, 0, 168))
            return policyErr('cancellationWindowHours must be 0-168');

        if (typeof returnsAccepted !== 'boolean')
            return policyErr('returnsAccepted must be boolean');

        if (returnsAccepted && !inRange(returnWindowDays, 0, 60))
            return policyErr('returnWindowDays must be 0-60 when returnsAccepted');

        if (!inRange(refundProcessingTimeDays, 1, 30))
            return policyErr('refundProcessingTimeDays must be 1-30');

        /* ------------------------------------------------------------------ */
        /* 3. Permission check (existing)                                     */
        /* ------------------------------------------------------------------ */
        const merchant = await knex('merchants')
            .select('isPlatformMerchant')
            .where('merchantId', merchantId)
            .first();

        if (!merchant) {
            logger.error(
                { merchantId },
                'Authenticated merchantId not found in merchants table.'
            );
            return reply.status(403).send({ error: 'Forbidden: Invalid merchant.' });
        }

        const canCreatePlatformStore = merchant.isPlatformMerchant;
        const finalIsPlatformOwned =
            canCreatePlatformStore && isPlatformOwned === true;

        /* ------------------------------------------------------------------ */
        /* 4. Uniqueness check (existing)                                     */
        /* ------------------------------------------------------------------ */
        const existingStore = await knex('stores')
            .where('storeId', storeId)
            .orWhere('storeHandle', storeHandle)
            .first();

        if (existingStore) {
            if (existingStore.storeId === storeId) {
                return reply
                    .status(409)
                    .send({ error: `Store with ID ${storeId} already exists` });
            }
            if (existingStore.storeHandle === storeHandle) {
                return reply
                    .status(409)
                    .send({ error: `Store handle @${storeHandle} already exists` });
            }
        }

        /* ------------------------------------------------------------------ */
        /* 5. Transaction – insert into stores + storePolicies + others       */
        /* ------------------------------------------------------------------ */
        try {
            const store = await knex.transaction(async trx => {
                // 5a. stores
                const [createdStore] = await trx('stores')
                    .insert({
                        storeId,
                        storeName,
                        storeHandle,
                        storeDescription,
                        storeLogoImage: null,
                        storeTags: JSON.stringify(storeTags || []),
                        isActive: false,
                        isPlatformOwned: finalIsPlatformOwned,
                        storeEmail,
                        storePhone,
                        category,
                        subcategory: subcategory || null,
                    })
                    .returning('*');

                // 5b. merchantStores
                await trx('merchantStores').insert({
                    merchantStoreId: uuidv4(),
                    merchantId,
                    storeId,
                    merchantRole: 'Owner',
                    canReceiveMessages: true,
                });

                // 5c. storeSettings (GST)
                await trx('storeSettings').insert({
                    storeId,
                    defaultGstRate,
                    defaultGstInclusive,
                });

                // 5d. storePolicies  <<< NEW TABLE INSERT
                await trx('storePolicies').insert({
                    storeId,
                    handlingTimeDays,
                    cancellationWindowHours,
                    returnsAccepted,
                    returnWindowDays: returnsAccepted ? returnWindowDays : 0,
                    refundProcessingTimeDays,
                });

                // 5e. merchantNotificationPreferences
                await trx('merchantNotificationPreferences').insert({
                    merchantId,
                    storeId,
                    muteAll: false,
                    newOrders: true,
                    chatMessages: true,
                    returnRequests: true,
                    orderCancellations: true,
                    miscellaneous: true,
                    ratingsAndReviews: true,
                    newFollowers: true,
                });

                return createdStore;
            });

            logger.info(
                { storeId: store.storeId, merchantId },
                'Store created successfully'
            );
            return reply.status(201).send({ store });
        } catch (err) {
            logger.error({ err, body: request.body }, 'Error creating store');
            if (err.routine === '_bt_check_unique')
                return reply
                    .status(409)
                    .send({ error: 'Unique constraint violation while creating store.' });

            return reply
                .status(500)
                .send({ error: 'Failed to create store due to an internal error.' });
        }
    });
};