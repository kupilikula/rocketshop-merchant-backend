'use strict';

const knex = require('@database/knexInstance');

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId } = request.params;
        const { groupingEnabled } = request.query;

        if (!storeId) {
            return reply.status(400).send({ error: 'storeId is required' });
        }

        try {
            // Fetch all shipping rules
            const shippingRules = await knex('shipping_rules')
                .where('storeId', storeId)
                .modify((qb) => {
                    if (groupingEnabled !== undefined) {
                        qb.andWhere('groupingEnabled', groupingEnabled === 'true');
                    }
                })
                .andWhere('isActive', true)
                .orderBy('created_at', 'desc');

            const ruleIds = shippingRules.map(rule => rule.shippingRuleId);

            let products = [];
            if (ruleIds.length > 0) {
                products = await knex('product_shipping_rules')
                    .join('products', 'product_shipping_rules.productId', 'products.productId')
                    .leftJoin('productCollections', 'products.productId', 'productCollections.productId')
                    .select(
                        'products.productId',
                        'products.productName',
                        'products.description',
                        'products.productTags',
                        'productCollections.collectionId',
                        'product_shipping_rules.shippingRuleId'
                    )
                    .whereIn('product_shipping_rules.shippingRuleId', ruleIds);
            }

            // Organize products by ruleId
            const productsByRule = {};

            for (const product of products) {
                const shippingRuleId = product.shippingRuleId;

                if (!productsByRule[shippingRuleId]) {
                    productsByRule[shippingRuleId] = [];
                }

                // Check if this product is already added
                let existingProduct = productsByRule[shippingRuleId].find(p => p.productId === product.productId);

                if (!existingProduct) {
                    existingProduct = {
                        productId: product.productId,
                        productName: product.productName,
                        description: product.description,
                        productTags: product.productTags || [],
                        collectionIds: []
                    };
                    productsByRule[shippingRuleId].push(existingProduct);
                }

                if (product.collectionId && !existingProduct.collectionIds.includes(product.collectionId)) {
                    existingProduct.collectionIds.push(product.collectionId);
                }
            }

            const enrichedRules = shippingRules.map(rule => ({
                ...rule,
                products: productsByRule[rule.shippingRuleId] || []
            }));

            return reply.send(enrichedRules);

        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Something went wrong fetching shipping rules' });
        }
    });
};