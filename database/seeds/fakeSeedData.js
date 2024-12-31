const { faker } = require('@faker-js/faker');
const orderStatusList = require("../../utils/orderStatusList");

exports.seed = async function (knex) {
    // Deletes ALL existing entries
    await knex('offers').del();
    await knex('order_status_history').del();
    await knex('order_items').del();
    await knex('orders').del();
    await knex('productCollections').del();
    await knex('products').del();
    await knex('collections').del();
    await knex('merchantStores').del();
    await knex('stores').del();
    await knex('customers').del();
    await knex('merchants').del();

    const merchants = Array.from({ length: 10 }, () => ({
        merchantId: faker.string.uuid(),
        merchantName: faker.person.fullName(),
        merchantPhone: faker.phone.number({style: 'international'}),
        merchantRole: faker.helpers.arrayElement(['Admin', 'Manager', 'Staff']),
        created_at: new Date(),
        updated_at: new Date(),
    }));
    await knex('merchants').insert(merchants);

    // Seed stores
    const stores = Array.from({ length: 10 }, () => ({
        storeId: faker.string.uuid(),
        storeName: faker.company.name(),
        storeDescription: faker.lorem.text(),
        storeBrandColor: faker.color.rgb(),
        storeLogoImage: faker.image.url(),
        storeTags: JSON.stringify(faker.helpers.uniqueArray(
            () => faker.word.adjective(),
            faker.number.int({ min: 0, max: 10 }))),
        created_at: new Date(),
        updated_at: new Date(),
    }));
    await knex('stores').insert(stores);

    // Seed merchantStores
    const merchantStores = [];

    for (const merchant of merchants) {
        // Assign 1-3 random stores to each merchant
        const assignedStores = faker.helpers.arrayElements(stores, faker.number.int({ min: 1, max: 3 }));

        for (const store of assignedStores) {
            merchantStores.push({
                merchantStoreId: faker.string.uuid(),
                merchantId: merchant.merchantId,
                storeId: store.storeId,
                role: faker.helpers.arrayElement(['Admin', 'Manager', 'Staff']),
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }

    await knex('merchantStores').insert(merchantStores);

    // Seed collections
    const collections = [];
    for (const store of stores) {
        const numCollections = faker.number.int({ min: 3, max: 5 });
        for (let i = 0; i < numCollections; i++) {
            collections.push({
                collectionId: faker.string.uuid(),
                collectionName: faker.commerce.department(),
                storeId: store.storeId,
                isActive: faker.datatype.boolean(),
                displayOrder: i + 1,
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }
    await knex('collections').insert(collections);

// Seed products
    const products = [];
    for (const collection of collections) {
        const numProducts = faker.number.int({ min: 1, max: 10 });
        for (let i = 0; i < numProducts; i++) {
            products.push({
                productId: faker.string.uuid(),
                productName: faker.commerce.productName(),
                description: faker.lorem.text(),
                price: faker.commerce.price({ min: 10, max: 10000, dec: 2 }),
                stock: faker.number.int({ min: 0, max: 100 }),
                isActive: faker.datatype.boolean(),
                productTags: JSON.stringify(
                    faker.helpers.uniqueArray(
                        () => faker.word.adjective(),
                        faker.number.int({ min: 0, max: 10 })
                    )
                ),
                storeId: collection.storeId,
                mediaItems: JSON.stringify(
                    faker.helpers.multiple(() => ({
                        mediaId: faker.string.uuid(),
                        mediaType: "image",
                        uri: faker.image.url(),
                        orientation: "landscape",
                        desc: faker.lorem.sentence(),
                    }), { count: 3 })
                ),

                // New Fields
                gstRate: faker.number.float({ min: 0, max: 28, fractionDigits: 1 }), // GST rates in India range up to 28%
                gstInclusive: faker.datatype.boolean(),
                rating: faker.number.float({ min: 0, max: 5, fractionDigits: 1 }),
                numberOfRatings: faker.number.int({ min: 0, max: 500 }),
                enableRatings: faker.datatype.boolean(),
                enableReviews: faker.datatype.boolean(),
                enableStockTracking: faker.datatype.boolean(),

                // Timestamps
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }
    await knex('products').insert(products);

    // Seed productCollections for ordering of products within collections
    const productCollections = [];
    for (const collection of collections) {
        const productsInStore = products.filter(p => p.storeId === collection.storeId);
        const numProductsInCollection = faker.number.int({ min: 5, max: 15 });
        const selectedProducts = faker.helpers.arrayElements(productsInStore, numProductsInCollection);

        selectedProducts.forEach((product, index) => {
            productCollections.push({
                productId: product.productId,
                collectionId: collection.collectionId,
                displayOrder: index + 1,
                created_at: new Date(),
                updated_at: new Date(),
            });
        });
    }
    await knex('productCollections').insert(productCollections);

    // Seed customers
    const customers = Array.from({ length: 20 }, () => ({
        customerId: faker.string.uuid(),
        fullName: faker.person.fullName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        customerAddress: faker.location.streetAddress(),
        created_at: new Date(),
        updated_at: new Date(),
    }));
    await knex('customers').insert(customers);

    // Seed orders
    const orders = [];
    const orderItemsData = [];
    const orderStatusHistoryData = [];
    for (let i = 0; i < 50; i++) {
        const orderId = faker.string.uuid();
        const store = faker.helpers.arrayElement(stores);
        const customer = faker.helpers.arrayElement(customers);
        const orderItems = faker.helpers.multiple(
            () => {
                const product = faker.helpers.arrayElement(products.filter(p => p.storeId === store.storeId));
                const quantity = faker.number.int({ min: 1, max: 10 });
                return {
                    productId: product.productId,
                    price: product.price,
                    quantity,
                };
            },
            { count: faker.number.int({ min: 1, max: 5 }) }
        );

        const orderStatus = faker.helpers.arrayElement(orderStatusList);
        const orderStatusUpdateTime = faker.date.recent();

        orders.push({
            orderId,
            storeId: store.storeId,
            customerId: customer.customerId,
            orderStatus,
            orderDate: faker.date.past(),
            orderTotal: orderItems.reduce(
                (sum, item) => sum + parseFloat(item.price) * item.quantity,
                0
            ),
            created_at: orderStatusUpdateTime,
            updated_at: orderStatusUpdateTime,
        });

        orderItems.forEach((item, item_i) => {
            orderItemsData.push({
                id: (i)*50 + item_i,
                orderId,
                productId: item.productId,
                quantity: item.quantity,
                price: item.price,
                created_at: new Date(),
                updated_at: new Date(),
            });
        });

        orderStatusHistoryData.push({
            id: faker.number.int({min: 100, max: 1000000}),
            orderId,
            orderStatus,
            updated_at: orderStatusUpdateTime,
        });
    }

    await knex('orders').insert(orders);
    await knex('order_items').insert(orderItemsData);
    await knex('order_status_history').insert(orderStatusHistoryData);

    // Seed offers
    const offers = [];

    for (const store of stores) {
        const products = await knex('products').where('storeId', store.storeId).select('productId');
        const collections = await knex('collections').where('storeId', store.storeId).select('collectionId');

        const numOffers = faker.number.int({ min: 1, max: 5 });

        for (let i = 0; i < numOffers; i++) {
            const randomProducts = faker.helpers.arrayElements(
                products.map((p) => p.productId),
                faker.number.int({ min: 1, max: Math.min(5, products.length) })
            );

            const randomCollections = faker.helpers.arrayElements(
                collections.map((c) => c.collectionId),
                faker.number.int({ min: 1, max: Math.min(3, collections.length) })
            );

            offers.push({
                offerId: faker.string.uuid(),
                storeId: store.storeId,
                offerName: faker.commerce.productAdjective() + " Offer",
                offerDescription: faker.lorem.sentence(),
                offerType: faker.helpers.arrayElement([
                    'Percentage Off',
                    'Fixed Amount Off',
                    'Buy N Get K Free',
                    'Free Shipping',
                ]),
                discountDetails: JSON.stringify(faker.helpers.arrayElement([
                    { percentage: faker.number.int({ min: 5, max: 50 }) },
                    { fixedAmount: faker.number.int({ min: 100, max: 1000 }) },
                    { buyN: faker.number.int({ min: 1, max: 5 }), getK: faker.number.int({ min: 1, max: 5 }) },
                ])),
                applicableTo: JSON.stringify({
                    products: randomProducts,
                    collections: randomCollections,
                    tags: faker.helpers.uniqueArray(
                        () => faker.word.adjective(),
                        faker.number.int({ min: 1, max: 3 })
                    ),
                }),
                conditions: JSON.stringify(faker.helpers.arrayElement([
                    null,
                    { minimumPurchaseAmount: faker.number.int({ min: 100, max: 500 }) },
                    { minimumItems: faker.number.int({ min: 1, max: 10 }) },
                ])),
                validityDateRange: JSON.stringify({
                    validFrom: faker.date.future(0.1),
                    validUntil: faker.date.future(1),
                }),
                isActive: faker.datatype.boolean(),
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }

    await knex('offers').insert(offers);

    console.log('Seeding completed successfully!');
};