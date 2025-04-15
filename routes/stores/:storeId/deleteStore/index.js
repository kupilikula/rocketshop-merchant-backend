'use strict';

const knex = require("@database/knexInstance");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// Configure your S3 client (DigitalOcean Spaces)
const s3Client = new S3Client({
    endpoint: 'https://blr1.digitaloceanspaces.com',
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SPACES_SECRET_KEY,
    },
});

const BUCKET_NAME = 'rocketshop-media';

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeId } = request.params;
        const { confirmationText, phone, otp } = request.body;
        const requestingMerchantId = request.user.merchantId;

        // 1. Verify OTP
        const latestOtp = await knex('otp_verification')
            .where({ phone, app: 'merchant' })
            .orderBy('created_at', 'desc')
            .first();

        if (!latestOtp || latestOtp.otp !== otp || !latestOtp.isVerified) {
            return reply.status(401).send({ error: 'Invalid or expired OTP' });
        }

        // 2. Check Admin role
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can delete the store.' });
        }

        // 3. Fetch and validate store
        const store = await knex('stores')
            .where({ storeId })
            .first();

        if (!store) {
            return reply.status(404).send({ error: 'Store not found' });
        }

        if (store.isActive) {
            return reply.status(400).send({ error: 'Store is active. Please deactivate the store first.' });
        }

        const expectedText = `Delete ${store.storeName}`;
        if (confirmationText !== expectedText) {
            return reply.status(400).send({ error: `Confirmation text mismatch. Please type exactly: ${expectedText}` });
        }

        // 4. Delete files from DigitalOcean Spaces (S3-compatible)
        try {
            const prefix = `stores/${storeId}/`;
            const listedObjects = await s3Client.send(new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: prefix,
            }));

            if (listedObjects.Contents && listedObjects.Contents.length > 0) {
                const deleteParams = {
                    Bucket: BUCKET_NAME,
                    Delete: {
                        Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key })),
                        Quiet: false,
                    },
                };
                await s3Client.send(new DeleteObjectsCommand(deleteParams));
            }
        } catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to delete store media from Spaces' });
        }

        // 5. Delete the store (cascading deletes from other tables)
        await knex('stores')
            .where({ storeId })
            .del();

        return reply.send({ success: true });
    });
};