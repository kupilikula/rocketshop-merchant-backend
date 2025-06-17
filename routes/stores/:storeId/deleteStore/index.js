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

const BUCKET_NAME = process.env.SPACES_BUCKET_NAME;

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { storeId } = request.params;
        const requestingMerchantId = request.user.merchantId;

        const { identifier, type, otp } = request.body;

        // --- 1. UPDATED: Input Validation ---
        if (!identifier || !type || !otp) {
            return reply.status(400).send({ error: 'Identifier, type, and OTP are required.' });
        }
        if (type === 'email' && !isValidEmail(identifier)) {
            return reply.status(400).send({ error: 'Invalid email format provided.' });
        } else if (type === 'phone' && !isValidE164Phone(identifier)) {
            return reply.status(400).send({ error: 'Invalid phone number format. Expected E.164.' });
        }

        // --- 2. UPDATED: Robust OTP Verification ---
        let otpQuery = knex('otp_verification')
            .where({
                context: 'DELETE_STORE', // This context is specific to deleting a store
                app: 'merchant',
                otp: otp,
                isVerified: true
            })
            .orderBy('created_at', 'desc');

        if (type === 'phone') {
            otpQuery = otpQuery.andWhere({ phone: identifier });
        } else { // type === 'email'
            otpQuery = otpQuery.andWhere({ email: identifier });
        }
        const latestOtp = await otpQuery.first();

        if (!latestOtp) {
            fastify.log.warn({ msg: 'Delete store attempt with invalid/unverified OTP.', identifier, storeId });
            return reply.status(401).send({ error: 'Invalid or unverified OTP session.' });
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

        await knex('otp_verification').where({ otpId: latestOtp.otpId }).del();

        return reply.send({ success: true });
    });
};