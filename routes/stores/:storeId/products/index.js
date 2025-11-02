'use strict';

const knex = require("@database/knexInstance");
const dayjs = require('dayjs');
const {getSalesEligibleOrderStatuses} = require("../../../../utils/orderStatusList");
const {v4: uuidv4} = require("uuid");

const eligibleStatuses = getSalesEligibleOrderStatuses();

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      // 1. Fetch products
      const products = await knex('products')
          .where({ storeId })
          .orderBy('created_at', 'desc');

      if (!products || products.length === 0) {
        return reply.status(200).send([]);
      }

      const productIds = products.map((p) => p.productId);

      // 2. Define time ranges
      const now = dayjs();
      const timeRanges = {
        day: now.subtract(1, 'day').toISOString(),
        week: now.subtract(1, 'week').toISOString(),
        month: now.subtract(1, 'month').toISOString(),
        year: now.subtract(1, 'year').toISOString(),
      };

      // 3. Fetch order_items joined with orders in one query (filter by storeId + relevant time ranges)
      const orderItems = await knex('order_items')
          .join('orders', 'order_items.orderId', 'orders.orderId')
          .where('orders.storeId', storeId)
          .whereIn('orders.orderStatus', eligibleStatuses)
          .where('orders.orderDate', '>=', timeRanges.year) // only last year data needed
          .whereIn('order_items.productId', productIds)
          .select(
              'order_items.productId',
              'order_items.price',
              'order_items.quantity',
              'orders.orderDate'
          );

      // 4. Group sales by productId and time range
      const salesByProduct = {};

      for (const item of orderItems) {
        const { productId, price, quantity, orderDate } = item;
        const orderTime = dayjs(orderDate);
        const saleAmount = Number(price) * quantity;

        if (!salesByProduct[productId]) {
          salesByProduct[productId] = {
            day: { revenue: 0, count: 0 },
            week: { revenue: 0, count: 0 },
            month: { revenue: 0, count: 0 },
            year: { revenue: 0, count: 0 },
          };
        }

        if (orderTime.isAfter(timeRanges.day)) {
          salesByProduct[productId].day.revenue += saleAmount;
          salesByProduct[productId].day.count += 1;
        }
        if (orderTime.isAfter(timeRanges.week)) {
          salesByProduct[productId].week.revenue += saleAmount;
          salesByProduct[productId].week.count += 1;
        }
        if (orderTime.isAfter(timeRanges.month)) {
          salesByProduct[productId].month.revenue += saleAmount;
          salesByProduct[productId].month.count += 1;
        }
        if (orderTime.isAfter(timeRanges.year)) {
          salesByProduct[productId].year.revenue += saleAmount;
          salesByProduct[productId].year.count += 1;
        }
      }

      // 5. Map collections
      const productCollections = await knex('productCollections')
          .join('collections', 'productCollections.collectionId', 'collections.collectionId')
          .whereIn('productCollections.productId', productIds)
          .select(
              'productCollections.productId',
              'collections.collectionId',
              'collections.collectionName',
                'collections.isActive'
          );

      const collectionsByProduct = productCollections.reduce((acc, pc) => {
        if (!acc[pc.productId]) acc[pc.productId] = [];
        acc[pc.productId].push({
          collectionId: pc.collectionId,
          collectionName: pc.collectionName,
          isActive: pc.isActive,
        });
        return acc;
      }, {});

      // 6. Attach sales + collections to each product
      const productsWithStats = products.map((product) => {
        const stats = salesByProduct[product.productId] || {
          day: { revenue: 0, count: 0 },
          week: { revenue: 0, count: 0 },
          month: { revenue: 0, count: 0 },
          year: { revenue: 0, count: 0 },
        };

        return {
          ...product,
          collections: collectionsByProduct[product.productId] || [],
          salesStats: stats,
        };
      });

      return reply.send(productsWithStats);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch products for the store.' });
    }
  });

  fastify.post('/', async (request, reply) => {
    const { storeId } = request.params;

    try {
      const newProduct = request.body
      const collectionIds = newProduct.collections;
      const variantInfo = newProduct.variantInfo || undefined;
      const shipping = newProduct.shipping || {};

      const insertProduct = {
        ...newProduct,
        storeId:  storeId,
        attributes: JSON.stringify(newProduct.attributes),
        mediaItems: JSON.stringify(newProduct.mediaItems),
        productTags: JSON.stringify(newProduct.productTags),
        created_at: new Date(),
        updated_at: new Date(),
      }
      delete insertProduct.collections;
      delete insertProduct.variantInfo;
      delete insertProduct.shipping;

      // Insert the new product into the database
      await knex('products')
          .insert(insertProduct);

      // Insert rows in the productCollections table
      if (Array.isArray(collectionIds) && collectionIds.length > 0) {
        const productCollectionsData = [];

        for (const collectionId of collectionIds) {
          // Fetch the current maximum displayOrder for the collection
          const maxDisplayOrder = await knex('productCollections')
              .where({ collectionId })
              .max('displayOrder as maxOrder')
              .first();

          // Set the displayOrder to the next available position (last index + 1)
          const displayOrder = (maxDisplayOrder?.maxOrder || 0) + 1;

          productCollectionsData.push({
            productId: newProduct.productId,
            collectionId,
            displayOrder,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }

        await knex('productCollections').insert(productCollectionsData);
      }

      // Handle variant functionality if provided
      if (variantInfo) {
        const { parentProductId, differingAttributes } = variantInfo;

        // Fetch parent product
        const parentProduct = await knex("products").where({ productId: parentProductId }).first();
        if (!parentProduct) {
          return res.status(400).json({ error: "Parent product does not exist." });
        }

        // Fetch parent product's variant group (if it exists)
        const parentVariant = await knex("productVariants")
            .where({ productId: parentProductId })
            .first();

        let variantGroupId;

        if (parentVariant) {
          // Use the existing variant group
          variantGroupId = parentVariant.variantGroupId;
        } else {
          // Create a new variant group

          const [newGroup] = await knex("variantGroups").insert(
              {
                variantGroupId: uuidv4(),
                storeId,
                name: `Variant Group for ${parentProduct.productName}`,
              },
              ["variantGroupId"]
          );

          variantGroupId = newGroup.variantGroupId;

          // Compute parent product's differing attributes
          const parentDifferingAttributes = differingAttributes.map(({ key }) => {
            const parentValue = parentProduct.attributes.find((attr) => attr.key === key)?.value;
            return { key, value: parentValue || null };
          });

          // Add parent product to the new group
          await knex("productVariants").insert({
            productVariantId: uuidv4(),
            productId: parentProductId,
            variantGroupId,
            differingAttributes: JSON.stringify(parentDifferingAttributes),
          });
        }

        // Add the new product to the variant group
        await knex("productVariants").insert({
          productVariantId: uuidv4(),
          productId: newProduct.productId,
          variantGroupId,
          differingAttributes: JSON.stringify(differingAttributes),
        });
      }

      if (shipping.shippingRuleChoice==='createNew' || shipping.shippingRuleChoice==='cloneExisting') {
        const {
          ruleName,
          conditions,
          groupingEnabled,
          isActive
        } = shipping.newShippingRule;

        if (!Array.isArray(conditions) || conditions.length === 0) {
          return reply.code(400).send({
            success: false,
            error: 'Missing required fields in shipping rule: conditions must be provided.'
          });
        }

        // Validate fallback condition
        const fallback = conditions.find(c => Array.isArray(c.when) && c.when.length === 0);

        if (!fallback) {
          return reply.code(400).send({
            success: false,
            error: 'Must include a fallback condition with when: [].'
          });
        }

        if (fallback.baseCost === undefined || !fallback.costModifiers) {
          return reply.code(400).send({
            success: false,
            error: 'Fallback condition must include baseCost and costModifiers.'
          });
        }

        const shippingRuleId = uuidv4();

        try {
          await knex('shipping_rules').insert({
            shippingRuleId,
            storeId,
            ruleName,
            groupingEnabled: groupingEnabled || false,
            conditions: JSON.stringify(conditions),
            isActive: isActive !== false,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
          });


          // Delete any existing association (only one allowed per product)
          await knex('product_shipping_rules')
              .where({ productId: newProduct.productId })
              .del();

          // Create new association
          const assignmentId = uuidv4();
          const now = new Date();

          await knex('product_shipping_rules').insert({
            assignmentId,
            productId: newProduct.productId,
            shippingRuleId,
            created_at: now,
            updated_at: now
          });

        } catch (error) {
          console.error('Error creating shipping rule:', error);
          return reply.code(500).send({
            success: false,
            error: 'Internal Server Error',
          });
        }
      } else if (shipping.shippingRuleChoice==='useExisting') {

        // Check if shipping rule exists
        const rule = await knex('shipping_rules')
            .where({ shippingRuleId: shipping.selectedExistingShippingRuleId })
            .first();

        if (!rule) {
          return reply.code(404).send({ error: 'Shipping rule not found' });
        }

        // Delete any existing association (only one allowed per product)
        await knex('product_shipping_rules')
            .where({ productId: newProduct.productId })
            .del();

        // Create new association
        const assignmentId = uuidv4();
        const now = new Date();

        await knex('product_shipping_rules').insert({
          assignmentId,
          productId: newProduct.productId,
          shippingRuleId: shipping.selectedExistingShippingRuleId,
          created_at: now,
          updated_at: now
        });
      } else if (shipping.shippingRuleChoice==='noShipping') {

        // Check if rule already exists
        let rule = await knex('shipping_rules')
            .where({ storeId, ruleName: 'No Shipping', isActive: true })
            .first();

        if (!rule) {
          const newShippingRuleId = uuidv4();
          const timestamps = { created_at: new Date(), updated_at: new Date() };

          rule = {
            shippingRuleId: newShippingRuleId,
            storeId,
            ruleName: 'No Shipping',
            groupingEnabled: true,
            isActive: true,
            conditions: JSON.stringify([
              {
                when: [],
                baseCost: 0,
                costModifiers: {
                  extraPerItemEnabled: false,
                  discountEnabled: false,
                  capEnabled: false,
                },
              },
            ]),
            ...timestamps,
          };

          await knex('shipping_rules').insert(rule);
        }

        const existingAssignment = await knex('product_shipping_rules')
            .where({ productId: newProduct.productId})
            .first();

        if (existingAssignment) {
          // Optional: update to new rule
          await knex('product_shipping_rules')
              .where({ productId: newProduct.productId })
              .update({
                shippingRuleId: rule.shippingRuleId,
                updated_at: new Date(),
              });
        } else {
          const assignmentId = uuidv4();
          await knex('product_shipping_rules').insert({
            assignmentId,
            productId: newProduct.productId,
            shippingRuleId: rule.shippingRuleId,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      return reply.send({ message: 'Product added successfully.'});
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to add product.' });
    }
  });

  fastify.delete('/', async function (request, reply) {
    console.time('Total Delete Product Request');

    const { storeId, productId } = request.params;
    const requestingMerchantId = request.user.merchantId;

    // 1. Check Admin role
    const merchant = await knex('merchantStores')
        .where({ storeId, merchantId: requestingMerchantId })
        .first();

    if (!merchant || !['Owner','Admin'].includes(merchant.merchantRole)) {
      console.timeEnd('Total Delete Product Request');
      return reply.status(403).send({ error: 'Only Admin/Owner merchants can delete products.' });
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