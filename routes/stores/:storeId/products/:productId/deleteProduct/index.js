'use strict';

const knex = require("@database/knexInstance");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// Configure S3 client (DigitalOcean Spaces)
const s3Client = new S3Client({
    endpoint: 'https://blr1.digitaloceanspaces.com',
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SPACES_SECRET_KEY,
    },
});

const BUCKET_NAME = process.env.SPACES_BUCKET_NAME;

async function deleteProductMedia(storeId, productId) {
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
}

async function deleteProductFromDb(storeId, productId) {
    await knex('products')
        .where({ storeId, productId })
        .del();
}

module.exports = async function (fastify, opts) {
    fastify.delete('/', async function (request, reply) {
        console.time('Total Delete Product Request');

        const { storeId, productId } = request.params;
        const requestingMerchantId = request.user.merchantId;

        // 1. Check Admin role
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();

        if (!merchant || merchant.merchantRole !== 'Admin') {
            console.timeEnd('Total Delete Product Request');
            return reply.status(403).send({ error: 'Only Admin merchants can delete products.' });
        }

        // 2. Fetch and validate product
        const product = await knex('products')
            .where({ storeId, productId })
            .first();

        if (!product) {
            console.timeEnd('Total Delete Product Request');
            return reply.status(404).send({ error: 'Product not found' });
        }

        // 3. Immediately send success response
        reply.send({ success: true });

        console.timeEnd('Total Delete Product Request');

        // 4. In background, delete media and DB
        setImmediate(async () => {
            console.time('Background Parallel Delete');
            try {
                await Promise.all([
                    deleteProductMedia(storeId, productId),
                    deleteProductFromDb(storeId, productId),
                ]);
                console.timeEnd('Background Parallel Delete');
                fastify.log.info(`Background deletion for product ${productId} completed.`);
            } catch (err) {
                console.error('Background deletion failed:', err);
            }
        });
    });
};