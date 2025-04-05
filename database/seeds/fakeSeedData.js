const { faker } = require('@faker-js/faker');
const {orderStatusList} = require("../../utils/orderStatusList");

exports.seed = async function (knex) {
    // Deletes ALL existing entries
    await knex('customer_saved_items').del();
    await knex('offers').del();
    await knex('order_status_history').del();
    await knex('order_items').del();
    await knex('orders').del();
    await knex('productCollections').del();
    await knex('product_reviews').del();
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

// Map storeId to their collections for fast lookup
    const storeCollectionsMap = collections.reduce((acc, collection) => {
        if (!acc[collection.storeId]) acc[collection.storeId] = [];
        acc[collection.storeId].push(collection.collectionId);
        return acc;
    }, {});

    for (const store of stores) {
        const numProducts = faker.number.int({ min: 20, max: 200 }); // Ensure each store has products
        const storeCollectionIds = storeCollectionsMap[store.storeId] || [];

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
                storeId: store.storeId,
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

            // ✅ Ensure product is part of at least one collection
            if (storeCollectionIds.length > 0) {
                const numCollectionsForProduct = faker.number.int({ min: 1, max: Math.min(3, storeCollectionIds.length) });
                const selectedCollections = faker.helpers.arrayElements(storeCollectionIds, numCollectionsForProduct);
                selectedCollections.forEach((collectionId, index) => {
                    productCollections.push({
                        productId,
                        collectionId,
                        displayOrder: index + 1,
                        created_at,
                        updated_at,
                    });
                });
            }
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

    console.log("Seeding customers...");
    const customers = Array.from({ length: 20 }, () => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            customerId: faker.string.uuid(),
            customerHandle: faker.internet.username(), // Random customer handle
            fullName: faker.person.fullName(),
            email: faker.internet.email(),
            phone: faker.phone.number(),
            created_at,
            updated_at,
        };
    });
    await knex("customers").insert(customers);
    console.log("Customers seeded.");

// Seed deliveryAddresses
    console.log("Seeding delivery addresses...");
    const deliveryAddresses = [];
    const recipientAddressesMap = {}; // To map customerId to address IDs for each customer

    for (const customer of customers) {
        const numAddresses = faker.number.int({ min: 2, max: 5 }); // Generate at least 2 addresses to ensure a subset can be assigned
        const customerAddresses = Array.from({ length: numAddresses }, () => {
            const { created_at, updated_at } = generateTimestamps();
            return {
                addressId: faker.string.uuid(),
                customerId: customer.customerId,
                street1: faker.location.streetAddress(),
                street2: faker.datatype.boolean() ? faker.location.secondaryAddress() : null,
                city: faker.location.city(),
                state: faker.location.state(),
                country: faker.location.country(),
                postalCode: faker.location.zipCode(),
                created_at,
                updated_at,
            };
        });

        // Assign a subset of addresses to the default recipient
        const subsetSize = faker.number.int({ min: 1, max: Math.floor(numAddresses / 2) }); // Random subset size
        const assignedAddresses = faker.helpers.arrayElements(customerAddresses, subsetSize);

        deliveryAddresses.push(...assignedAddresses);

        // Map the assigned addresses to the customer for assigning recipients
        recipientAddressesMap[customer.customerId] = assignedAddresses.map((a) => a.addressId);
    }

    console.log("Filtered delivery addresses:", deliveryAddresses);

// Insert delivery addresses
    await knex("deliveryAddresses").insert(deliveryAddresses);
    console.log("Delivery addresses seeded.");

// Seed recipients and recipientAddresses
    console.log("Seeding recipients and recipientAddresses...");
    const recipients = [];
    const recipientAddresses = [];

    for (const customer of customers) {
        const { created_at, updated_at } = generateTimestamps();

        // Default recipient is the customer
        const defaultRecipientId = faker.string.uuid();
        recipients.push({
            recipientId: defaultRecipientId,
            customerId: customer.customerId,
            fullName: customer.fullName,
            phone: customer.phone,
            isDefaultRecipient: true,
            created_at,
            updated_at,
        });

        // Assign the subset of addresses to the default recipient
        const customerAddresses = recipientAddressesMap[customer.customerId];
        customerAddresses.forEach((addressId, index) => {
            recipientAddresses.push({
                recipientAddressId: faker.string.uuid(),
                recipientId: defaultRecipientId,
                addressId,
                isDefault: index === 0, // Mark the first address as default
                created_at,
                updated_at,
            });
        });

        // Add additional recipients
        const numRecipients = faker.number.int({ min: 0, max: 3 });
        for (let i = 0; i < numRecipients; i++) {
            const additionalRecipientId = faker.string.uuid();
            recipients.push({
                recipientId: additionalRecipientId,
                customerId: customer.customerId,
                fullName: faker.person.fullName(),
                phone: faker.phone.number(),
                isDefaultRecipient: false,
                created_at,
                updated_at,
            });

            // Assign a random subset of addresses to each additional recipient
            const randomAddresses = faker.helpers.arrayElements(customerAddresses, faker.number.int({ min: 1, max: customerAddresses.length }));
            randomAddresses.forEach((addressId, index) => {
                recipientAddresses.push({
                    recipientAddressId: faker.string.uuid(),
                    recipientId: additionalRecipientId,
                    addressId,
                    isDefault: index === 0, // Mark the first address as default for this recipient
                    created_at,
                    updated_at,
                });
            });
        }
    }

// Insert recipients
    await knex("recipients").insert(recipients);
    console.log("Recipients seeded.");

// Insert recipientAddresses
    await knex("recipientAddresses").insert(recipientAddresses);
    console.log("Recipient addresses seeded.");

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
                followed_at: new Date(),
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
                saved_at: faker.date.recent(30), // Saved within the last 30 days
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

        // Select a random recipient and their default delivery address for this customer
        const customerRecipients = recipients.filter((r) => r.customerId === customer.customerId);
        const recipient = faker.helpers.arrayElement(customerRecipients);
        const recipientDefaultAddress = recipientAddresses.find(
            (ra) => ra.recipientId === recipient.recipientId && ra.isDefault
        );


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
            recipient: JSON.stringify({
                recipientId: recipient.recipientId,
                fullName: recipient.fullName,
                phone: recipient.phone,
                isDefaultRecipient: recipient.isDefaultRecipient
            }),
            deliveryAddress: JSON.stringify({
                street1: recipientDefaultAddress?.street1,
                street2: recipientDefaultAddress?.street2,
                city: recipientDefaultAddress?.city,
                state: recipientDefaultAddress?.state,
                country: recipientDefaultAddress?.country,
                postalCode: recipientDefaultAddress?.postalCode,
            }),
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

    console.log("Seeding product reviews...");

    const reviews = [];
    const productRatingsMap = {}; // To track ratings for average calculation

    for (const order of orders) {
        // Consider only orders with "Shipped" or later status
        const completedStatuses = orderStatusList.slice(orderStatusList.indexOf("Payment Received"));
        if (!completedStatuses.includes(order.orderStatus)) continue;

        // Get items in this order
        const items = orderItemsData.filter((item) => item.orderId === order.orderId);

        for (const item of items) {
            // 70% chance this user rated the product
            if (faker.datatype.boolean({ probability: 0.7 })) {
                const rating = faker.number.int({ min: 1, max: 5 });
                const hasReviewText = faker.datatype.boolean({ probability: 0.6 });

                const review = {
                    reviewId: faker.string.uuid(),
                    productId: item.productId,
                    customerId: order.customerId,
                    rating,
                    review: hasReviewText ? faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })) : null,
                    isVisible: true,
                    created_at: faker.date.recent(90),
                    updated_at: new Date(),
                };

                reviews.push(review);

                // Track for aggregate calculation
                if (!productRatingsMap[item.productId]) {
                    productRatingsMap[item.productId] = [];
                }
                productRatingsMap[item.productId].push(rating);
            }
        }
    }

    await knex("product_reviews").insert(reviews);
    console.log(`Inserted ${reviews.length} product reviews.`);

// Update product rating aggregates
    for (const [productId, ratings] of Object.entries(productRatingsMap)) {
        const total = ratings.reduce((sum, r) => sum + r, 0);
        const avg = (total / ratings.length).toFixed(2);
        await knex("products")
            .where({ productId })
            .update({
                rating: avg,
                numberOfRatings: ratings.length,
            });
    }

    console.log("Product ratings updated.");


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

            const offerType = faker.helpers.arrayElement([
                'Percentage Off',
                'Fixed Amount Off',
                'Buy N Get K Free',
                'Free Shipping',
            ]);
            const discountDetails = offerType==='Percentage Off' ?  { percentage: faker.number.int({ min: 5, max: 50 }) }
                : (offerType==='Fixed Amount Off' ? { fixedAmount: faker.number.int({ min: 100, max: 1000 }) } : { buyN: faker.number.int({ min: 1, max: 5 }), getK: faker.number.int({ min: 1, max: 5 }) });
            offers.push({
                offerId: faker.string.uuid(),
                storeId: store.storeId,
                offerName: faker.commerce.productAdjective() + " Offer",
                offerDisplayText: faker.lorem.words(3),
                offerCode: faker.string.alphanumeric({length: 8}),
                requireCode: faker.datatype.boolean(),
                offerType: offerType,
                discountDetails: JSON.stringify(discountDetails),
                applicableTo: JSON.stringify({
                    storeWide: faker.datatype.boolean({probability: 0.1}),
                    productIds: randomProducts,
                    collectionIds: randomCollections,
                    productTags: faker.helpers.uniqueArray(
                        () => faker.word.adjective(),
                        faker.number.int({ min: 1, max: 3 })
                    ),
                }),
                conditions: JSON.stringify(faker.helpers.arrayElement([
                    {},
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