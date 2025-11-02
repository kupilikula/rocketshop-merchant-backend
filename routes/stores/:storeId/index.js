// PATCH /stores/:storeId/updateStoreDetails

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

    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;

        try {
            const store = await knex('stores')
                .where('storeId', storeId)
                .first();

            if (!store) {
                return reply.status(404).send({ error: 'Store not found' });
            }

            return reply.send({ store });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.patch('/', async (request, reply) => {
        const { storeId } = request.params;
        const { storeName, storeHandle, storeDescription, storeTags, storeLogoImage, storeEmail, storePhone } = request.body;

        if (!storeName && !storeHandle && !storeDescription && !storeTags && !storeLogoImage) {
            return reply.status(400).send({ error: "At least one field must be provided for update." });
        }

        const updatePayload = {};

        if (storeName) updatePayload.storeName = storeName;
        if (storeDescription) updatePayload.storeDescription = storeDescription;
        if (storeTags) updatePayload.storeTags = JSON.stringify(storeTags);
        if (storeLogoImage) updatePayload.storeLogoImage = storeLogoImage;
        if (storeEmail) updatePayload.storeEmail = storeEmail;
        if (storePhone) updatePayload.storePhone = storePhone;

        if (storeHandle) {
            const existingHandle = await knex("stores")
                .whereNot({ storeId })
                .andWhere({ storeHandle })
                .first();

            if (existingHandle) {
                return reply.status(400).send({ error: "Store Handle already taken" });
            }

            updatePayload.storeHandle = storeHandle;
        }

        updatePayload.updated_at = knex.fn.now();

        await knex("stores")
            .where({ storeId })
            .update(updatePayload);

        return reply.status(200).send({ success: true });
    });

    fastify.delete('/', async function (request, reply) {
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

        // 2. Check Owner role
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Owner') {
            return reply.status(403).send({ error: 'Only Owner merchants can delete the store.' });
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