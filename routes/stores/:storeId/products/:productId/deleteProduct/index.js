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

const BUCKET_NAME = 'rocketshop-media';

async function deleteProductMedia(storeId, productId) {
    console.time('S3 ListObjects + DeleteObjects total');

    const prefix = `stores/${storeId}/products/${productId}/`;

    console.time('S3 ListObjects');
    const listedObjects = await s3Client.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
    }));
    console.timeEnd('S3 ListObjects');

    if (listedObjects.Contents && listedObjects.Contents.length > 0) {
        console.time('S3 DeleteObjects');
        const deleteParams = {
            Bucket: BUCKET_NAME,
            Delete: {
                Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key })),
                Quiet: false,
            },
        };
        await s3Client.send(new DeleteObjectsCommand(deleteParams));
        console.timeEnd('S3 DeleteObjects');
    } else {
        console.log('No media files found to delete.');
    }

    console.timeEnd('S3 ListObjects + DeleteObjects total');
}

async function deleteProductFromDb(storeId, productId) {
    console.time('DB Delete Product Row');
    await knex('products')
        .where({ storeId, productId })
        .del();
    console.timeEnd('DB Delete Product Row');
}

module.exports = async function (fastify, opts) {
    fastify.delete('/', async function (request, reply) {
        console.time('Total Delete Product Request');

        const { storeId, productId } = request.params;
        const requestingMerchantId = request.user.merchantId;

        // 1. Check Admin role
        console.time('DB Fetch Merchant Role');
        const merchant = await knex('merchantStores')
            .where({ storeId, merchantId: requestingMerchantId })
            .first();
        console.timeEnd('DB Fetch Merchant Role');

        if (!merchant || merchant.merchantRole !== 'Admin') {
            console.timeEnd('Total Delete Product Request');
            return reply.status(403).send({ error: 'Only Admin merchants can delete products.' });
        }

        // 2. Fetch and validate product
        console.time('DB Fetch Product');
        const product = await knex('products')
            .where({ storeId, productId })
            .first();
        console.timeEnd('DB Fetch Product');

        if (!product) {
            console.timeEnd('Total Delete Product Request');
            return reply.status(404).send({ error: 'Product not found' });
        }

        // 3. Parallelize deletion of media and DB record
        try {
            console.time('Parallel Media + DB Deletion');
            await Promise.all([
                deleteProductMedia(storeId, productId),
                deleteProductFromDb(storeId, productId),
            ]);
            console.timeEnd('Parallel Media + DB Deletion');
        } catch (err) {
            request.log.error(err);
            console.timeEnd('Total Delete Product Request');
            return reply.status(500).send({ error: 'Failed to delete product' });
        }

        console.timeEnd('Total Delete Product Request');
        return reply.send({ success: true });
    });
};