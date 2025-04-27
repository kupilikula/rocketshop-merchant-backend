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
        const { storeId, productId } = request.params;
        // const { phone, otp } = request.body;
        const requestingMerchantId = request.user.merchantId;

        // 2. Check Admin role
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            return reply.status(403).send({ error: 'Only Admin merchants can delete products.' });
        }

        // 3. Fetch and validate product
        const product = await knex('products')
            .where({ storeId, productId })
            .first();

        if (!product) {
            return reply.status(404).send({ error: 'Product not found' });
        }

        // 4. Delete product media files from Spaces
        try {
            const prefix = `stores/${storeId}/products/${productId}/`;
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
            return reply.status(500).send({ error: 'Failed to delete product media from Spaces' });
        }

        // 5. Delete the product from database
        await knex('products')
            .where({ storeId, productId })
            .del();

        return reply.send({ success: true });
    });
};