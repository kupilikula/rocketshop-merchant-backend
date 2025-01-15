const { faker } = require('@faker-js/faker');
const orderStatusList = require("../../utils/orderStatusList");

exports.seed = async function (knex) {
    // Deletes ALL existing entries
    await knex('customer_saved_items').del();
    await knex('offers').del();
    await knex('order_status_history').del();
    await knex('order_items').del();
    await knex('orders').del();
    await knex('productCollections').del();
    await knex('products').del();
    await knex('collections').del();
    await knex('customer_followed_stores').del();
    await knex('merchantStores').del();
    await knex('stores').del();
    await knex('customers').del();
    await knex('merchants').del();

    // Helper function to generate realistic timestamps
    const generateTimestamps = () => {
        const created_at = faker.date.past(2); // Random date in the past 2 years
        const updated_at = faker.date.between({from: created_at, to: new Date()}); // After created_at but before now
        return { created_at, updated_at };
    };

    const merchants = Array.from({ length: 10 }, () => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            merchantId: faker.string.uuid(),
            merchantName: faker.person.fullName(),
            merchantPhone: faker.phone.number({ style: 'international' }),
            merchantRole: faker.helpers.arrayElement(['Admin', 'Manager', 'Staff']),
            created_at,
            updated_at,
        };
    });
    await knex('merchants').insert(merchants);
    console.log('Merchants seeded.');

    // Seed stores
    console.log('Seeding stores...');
    const stores = Array.from({ length: 10 }, () => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            storeId: faker.string.uuid(),
            storeName: faker.company.name(),
            storeDescription: faker.lorem.text(),
            storeBrandColor: faker.color.rgb(),
            storeLogoImage: faker.image.url(),
            storeTags: JSON.stringify(faker.helpers.uniqueArray(
                () => faker.word.adjective(),
                faker.number.int({ min: 0, max: 10 })
            )),
            storeHandle: faker.internet.username(), // Random store handle
            followerCount: 0, // Default to 0, will be updated after customer_followed_stores seeding
            created_at,
            updated_at,
        };
    });
    await knex('stores').insert(stores);
    console.log('Stores seeded.');

    // Seed merchantStores
    console.log('Seeding merchantStores...');
    const merchantStores = [];

    for (const merchant of merchants) {
        const assignedStores = faker.helpers.arrayElements(stores, faker.number.int({ min: 1, max: 3 }));

        for (const store of assignedStores) {
            const { created_at, updated_at } = generateTimestamps();
            merchantStores.push({
                merchantStoreId: faker.string.uuid(),
                merchantId: merchant.merchantId,
                storeId: store.storeId,
                role: faker.helpers.arrayElement(['Admin', 'Manager', 'Staff']),
                created_at,
                updated_at,
            });
        }
    }

    await knex('merchantStores').insert(merchantStores);
    console.log('MerchantStores seeded.');

    // Seed collections
    console.log('Seeding collections...');
    const collections = [];
    for (const store of stores) {
        const numCollections = faker.number.int({ min: 3, max: 10 });
        for (let i = 0; i < numCollections; i++) {
            const { created_at, updated_at } = generateTimestamps();
            collections.push({
                collectionId: faker.string.uuid(),
                collectionName: faker.commerce.department(),
                storeId: store.storeId,
                isActive: faker.datatype.boolean(),
                storeFrontDisplay: faker.datatype.boolean(),
                storeFrontDisplayNumberOfItems: faker.helpers.arrayElement([2, 4, 6, 8]),
                displayOrder: i + 1,
                created_at,
                updated_at,
            });
        }
    }
    await knex('collections').insert(collections);
    console.log('Collections seeded.');

    // Seed products and ensure each product belongs to at least one collection
    console.log('Seeding products...');
    const products = [];
    const productCollections = [];
    const chunkSize = 500;

    for (const collection of collections) {
        const numProducts = faker.number.int({ min: 10, max: 100 });
        for (let i = 0; i < numProducts; i++) {
            const { created_at, updated_at } = generateTimestamps();
            const productId = faker.string.uuid();

            products.push({
                productId,
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
                gstRate: faker.helpers.arrayElement([0, 5, 12, 18, 28]),
                gstInclusive: faker.datatype.boolean(),
                rating: faker.number.float({ min: 0, max: 5, fractionDigits: 1 }),
                numberOfRatings: faker.number.int({ min: 0, max: 500 }),
                enableRatings: faker.datatype.boolean(),
                enableReviews: faker.datatype.boolean(),
                enableStockTracking: faker.datatype.boolean(),
                created_at,
                updated_at,
            });

            productCollections.push({
                productId,
                collectionId: collection.collectionId,
                displayOrder: i + 1,
                created_at,
                updated_at,
            });
        }
    }

    // Insert products in chunks
    console.log(`Inserting ${products.length} products in chunks of ${chunkSize}...`);
    for (let i = 0; i < products.length; i += chunkSize) {
        const chunk = products.slice(i, i + chunkSize);
        try {
            await knex('products').insert(chunk);
            console.log(`Inserted chunk ${Math.floor(i / chunkSize) + 1}`);
        } catch (error) {
            console.error(`Error inserting chunk ${Math.floor(i / chunkSize) + 1}:`, error);
            throw error;
        }
    }
    console.log('Products seeded.');

    // Insert productCollections
    console.log(`Inserting ${productCollections.length} productCollections...`);
    await knex('productCollections').insert(productCollections);
    console.log('ProductCollections seeded.');

    console.log('Seeding customers...');
    const customers = Array.from({ length: 20 }, () => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            customerId: faker.string.uuid(),
            fullName: faker.person.fullName(),
            email: faker.internet.email(),
            phone: faker.phone.number(),
            customerAddress: faker.location.streetAddress(),
            created_at,
            updated_at,
        };
    });
    await knex('customers').insert(customers);
    console.log('Customers seeded.');

    // Seed customer_followed_stores and update followerCount
    console.log('Seeding customer_followed_stores and updating followerCount...');
    const customerFollowedStores = [];
    const followerCounts = {};

    for (const customer of customers) {
        const followedStores = faker.helpers.arrayElements(stores, faker.number.int({ min: 1, max: 5 }));

        for (const store of followedStores) {
            customerFollowedStores.push({
                customerId: customer.customerId,
                storeId: store.storeId,
                followedAt: new Date(),
            });

            // Increment followerCount for the store
            followerCounts[store.storeId] = (followerCounts[store.storeId] || 0) + 1;
        }
    }

    await knex('customer_followed_stores').insert(customerFollowedStores);

    // Update followerCount in the stores table
    for (const storeId in followerCounts) {
        await knex('stores')
            .where({ storeId })
            .update({ followerCount: followerCounts[storeId] });
    }
    console.log('Customer_followed_stores seeded and followerCount updated.');

    // Seed saved_items
    const savedItems = [];
    for (const customer of customers) {
        const savedProducts = faker.helpers.arrayElements(products, faker.number.int({ min: 1, max: 10 }));
        for (const product of savedProducts) {
            savedItems.push({
                id: faker.string.uuid(),
                customerId: customer.customerId,
                productId: product.productId,
                savedAt: faker.date.recent(30), // Saved within the last 30 days
            });
        }
    }
    await knex('customer_saved_items').insert(savedItems);

    // Seed orders
    const orders = [];
    const orderItemsData = [];
    const orderStatusHistoryData = [];
    for (let i = 0; i < 500; i++) {
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