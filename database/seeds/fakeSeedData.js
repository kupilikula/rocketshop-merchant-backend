const { faker } = require('@faker-js/faker');
const {fakerEN_IN} = require('@faker-js/faker');
const {orderStatusList} = require("../../utils/orderStatusList");
const {business_types, categories: razorpayCategories} = require('../../utils/razorpayBusinessData');

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
            fullName: faker.person.fullName(),
            phone: fakerEN_IN.phone.number({ style: 'international' }),
            created_at,
            updated_at,
        };
    });
    await knex('merchants').insert(merchants);
    console.log('Merchants seeded.');

    // Seed stores
    console.log('Seeding stores...');
    const stores = Array.from({ length: 10 }, () => { // Or your desired number of stores
        const { created_at, updated_at } = generateTimestamps(); // Your existing function

        const companyName = faker.company.name(); // Used for storeName and legalBusinessName

        // Select businessType, category, and subCategory
        const selectedBusinessType = faker.helpers.arrayElement(business_types);
        const availableCategoryKeys = Object.keys(razorpayCategories);
        const selectedCategoryKey = faker.helpers.arrayElement(availableCategoryKeys);

        let selectedSubCategory = null;
        const categoryData = razorpayCategories[selectedCategoryKey];
        if (categoryData && categoryData.subcategories && categoryData.subcategories.length > 0) {
            // Flatten the subcategories array in case of nested arrays (like 'transport')
            const flatSubcategories = categoryData.subcategories.flat();
            if (flatSubcategories.length > 0) {
                selectedSubCategory = faker.helpers.arrayElement(flatSubcategories);
            }
        }

        return {
            storeId: faker.string.uuid(),
            storeName: companyName, // Use a consistent company name for store
            storeDescription: faker.lorem.paragraph(), // More appropriate for description
            storeLogoImage: faker.image.urlPicsumPhotos(), // Using Picsum for more variety
            storeTags: JSON.stringify(faker.helpers.uniqueArray(
                () => faker.commerce.department(), // More relevant tags
                faker.number.int({ min: 1, max: 5 })
            )),
            storeHandle: faker.internet.userName({ firstName: companyName.split(' ')[0] }).toLowerCase().replace(/[^a-z0-9_]/gi, ''), // Generate from company name
            followerCount: 0, // Default, update later
            isActive: faker.datatype.boolean({ probability: 0.9 }), // Most stores active

            // New Fields
            legalBusinessName: `${companyName} ${faker.company.buzzNoun()} Ltd.`, // Make it sound more legal
            storeEmail: faker.internet.email({ firstName: 'contact', provider: companyName.toLowerCase().replace(/[^a-z0-9]/gi, '') + '.com' }),
            storePhone: fakerEN_IN.phone.number({ style: 'international' }),
            businessType: selectedBusinessType,
            category: selectedCategoryKey,
            subcategory: selectedSubCategory, // Will be null if no subcategories or none selected
            registeredAddress: { // This will be automatically stringified by Knex for JSONB
                street1: faker.location.streetAddress(false), // street name and building number
                street2: faker.helpers.maybe(() => faker.location.secondaryAddress(), { probability: 0.4 }), // Optional
                city: faker.location.city(),
                state: faker.location.state(),
                country: 'India', // Fixed for context, or use faker.location.country()
                postalCode: faker.location.zipCode('######'),
            },
            isPlatformOwned: faker.datatype.boolean({ probability: 0.05 }), // Small chance of being platform owned

            created_at,
            updated_at,
        };
    });
    await knex('stores').insert(stores);
    console.log('Stores seeded.');

    console.log('Seeding storeSettings...');
    const storeSettings = stores.map((store) => ({
        storeId: store.storeId,
        defaultGstRate: faker.helpers.arrayElement([0, 5, 12, 18, 28]),
        defaultGstInclusive: faker.datatype.boolean(),
        created_at: store.created_at,
        updated_at: store.updated_at,
    }));

    await knex('storeSettings').insert(storeSettings);
    console.log('StoreSettings seeded.');

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
                merchantRole: faker.helpers.arrayElement(['Admin', 'Manager', 'Staff']),
                created_at,
                updated_at,
            });
        }
    }

    await knex('merchantStores').insert(merchantStores);
    console.log('MerchantStores seeded.');

    console.log('Seeding merchant notification preferences...');
    const merchantNotificationPreferences = merchantStores.map(merchantStore => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            merchantId: merchantStore.merchantId,
            storeId: merchantStore.storeId,
            muteAll: false,
            newOrders: true,
            chatMessages: true,
            returnRequests: true,
            orderCancellations: true,
            miscellaneous: true,
            ratingsAndReviews: true,
            newFollowers: true,
            created_at,
            updated_at
        };
    });

    await knex('merchantNotificationPreferences').insert(merchantNotificationPreferences);
    console.log('Merchant notification preferences seeded.');


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
                rating: 0,
                numberOfRatings: 0,
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


// 📦 Insert this after seeding products and productCollections
    console.log('Seeding shipping rules and product_shipping_rules...');
    const shippingRules = [];
    const productShippingAssignments = [];

    const storeProductsMap = products.reduce((acc, product) => {
        if (!acc[product.storeId]) acc[product.storeId] = [];
        acc[product.storeId].push(product);
        return acc;
    }, {});

    const randomizeShippingConditions = () => {
        const baseCostDefault = faker.number.int({ min: 20, max: 100 });
        const costModifiersDefault = {
            extraPerItemEnabled: faker.datatype.boolean(),
            extraPerItemCost: faker.number.int({ min: 5, max: 20 }),
            freeItemCount: faker.number.int({ min: 0, max: 5 }),
            discountEnabled: faker.datatype.boolean(),
            discountPercentage: faker.number.int({ min: 5, max: 20 }),
            discountThreshold: faker.number.int({ min: 500, max: 2000 }),
            capEnabled: faker.datatype.boolean(),
            capAmount: faker.number.int({ min: 100, max: 300 }),
        };

        const random = Math.random();

        if (random < 0.6) {
            return [
                {
                    when: [],
                    baseCost: baseCostDefault,
                    costModifiers: costModifiersDefault,
                }
            ];
        } else if (random < 0.8) {
            return [
                {
                    when: [
                        {
                            type: 'location',
                            operator: 'inside',
                            locationType: 'city',
                            city: 'Chennai',
                            state: 'Tamil Nadu',
                            country: 'India',
                        }
                    ],
                    baseCost: faker.number.int({ min: 20, max: 60 }),
                    costModifiers: costModifiersDefault,
                },
                {
                    when: [],
                    baseCost: baseCostDefault,
                    costModifiers: costModifiersDefault,
                }
            ];
        } else if (random < 0.9) {
            return [
                {
                    when: [
                        {
                            type: 'location',
                            operator: 'inside',
                            locationType: 'state',
                            state: 'Tamil Nadu',
                            country: 'India',
                        }
                    ],
                    baseCost: faker.number.int({ min: 25, max: 70 }),
                    costModifiers: costModifiersDefault,
                },
                {
                    when: [],
                    baseCost: baseCostDefault,
                    costModifiers: costModifiersDefault,
                }
            ];
        } else {
            return [
                {
                    when: [
                        {
                            type: 'location',
                            operator: 'inside',
                            locationType: 'country',
                            country: 'India',
                        }
                    ],
                    baseCost: faker.number.int({ min: 30, max: 80 }),
                    costModifiers: costModifiersDefault,
                },
                {
                    when: [],
                    baseCost: baseCostDefault,
                    costModifiers: costModifiersDefault,
                }
            ];
        }
    };

    const assignedProductIds = new Set();

    for (const store of stores) {
        const storeProducts = storeProductsMap[store.storeId] || [];
        if (storeProducts.length === 0) continue;

        // Create 10 groupingEnabled rules per store
        for (let i = 0; i < 10; i++) {
            const { created_at, updated_at } = generateTimestamps();
            const shippingRuleId = faker.string.uuid();

            shippingRules.push({
                shippingRuleId,
                storeId: store.storeId,
                ruleName: `Generic Shipping Rule ${i + 1} for ${store.storeName}`,
                conditions: JSON.stringify(randomizeShippingConditions()),
                groupingEnabled: true,
                isActive: true,
                created_at,
                updated_at,
            });

            const availableProducts = storeProducts.filter(p => !assignedProductIds.has(p.productId));
            const numProducts = Math.min(availableProducts.length, faker.number.int({ min: 5, max: 15 }));
            const selectedProducts = faker.helpers.arrayElements(availableProducts, numProducts);

            for (const product of selectedProducts) {
                const { created_at: a_created, updated_at: a_updated } = generateTimestamps();
                productShippingAssignments.push({
                    assignmentId: faker.string.uuid(),
                    productId: product.productId,
                    shippingRuleId,
                    created_at: a_created,
                    updated_at: a_updated,
                });
                assignedProductIds.add(product.productId);
            }
        }

        // Create 10 non-groupingEnabled rules per store
        const availableProducts = storeProducts.filter(p => !assignedProductIds.has(p.productId));
        const selectedProductsForCustomRules = faker.helpers.arrayElements(availableProducts, Math.min(10, availableProducts.length));

        for (const product of selectedProductsForCustomRules) {
            const { created_at, updated_at } = generateTimestamps();
            const shippingRuleId = faker.string.uuid();

            shippingRules.push({
                shippingRuleId,
                storeId: store.storeId,
                ruleName: `Custom Shipping for ${product.productName.slice(0, 20)}`,
                conditions: JSON.stringify(randomizeShippingConditions()),
                groupingEnabled: false,
                isActive: true,
                created_at,
                updated_at,
            });

            const { created_at: a_created, updated_at: a_updated } = generateTimestamps();
            productShippingAssignments.push({
                assignmentId: faker.string.uuid(),
                productId: product.productId,
                shippingRuleId,
                created_at: a_created,
                updated_at: a_updated,
            });
            assignedProductIds.add(product.productId);
        }
    }

// Patch: Any products still unassigned get their own custom non-grouping rule
    for (const product of products) {
        if (!assignedProductIds.has(product.productId)) {
            const { created_at, updated_at } = generateTimestamps();
            const shippingRuleId = faker.string.uuid();

            shippingRules.push({
                shippingRuleId,
                storeId: product.storeId,
                ruleName: `Auto Shipping for ${product.productName.slice(0, 20)}`,
                conditions: JSON.stringify(randomizeShippingConditions()),
                groupingEnabled: false,
                isActive: true,
                created_at,
                updated_at,
            });

            const { created_at: a_created, updated_at: a_updated } = generateTimestamps();
            productShippingAssignments.push({
                assignmentId: faker.string.uuid(),
                productId: product.productId,
                shippingRuleId,
                created_at: a_created,
                updated_at: a_updated,
            });

            assignedProductIds.add(product.productId);
        }
    }

    console.log(`Inserting ${shippingRules.length} shipping rules...`);
    await knex('shipping_rules').insert(shippingRules);

    console.log(`Inserting ${productShippingAssignments.length} product_shipping_rules...`);
    await knex('product_shipping_rules').insert(productShippingAssignments);

    console.log('Shipping rules and product_shipping_rules seeded.');


    console.log("Seeding customers...");
    const customers = Array.from({ length: 20 }, () => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            customerId: faker.string.uuid(),
            customerHandle: faker.internet.username(), // Random customer handle
            fullName: faker.person.fullName(),
            email: faker.internet.email(),
            phone: fakerEN_IN.phone.number({ style: 'international' }),
            created_at,
            updated_at,
        };
    });
    await knex("customers").insert(customers);
    console.log("Customers seeded.");

    console.log('Seeding customer notification preferences...');
    const customerNotificationPreferences = customers.map(customer => {
        const { created_at, updated_at } = generateTimestamps();
        return {
            customerId: customer.customerId,
            orderStatus: true,
            orderDelivery: true,
            chatMessages: true,
            miscellaneous: true,
            muteAll: false,
            created_at,
            updated_at
        };
    });

    await knex('customerNotificationPreferences').insert(customerNotificationPreferences);
    console.log('Customer notification preferences seeded.');


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

    // console.log("Filtered delivery addresses:", deliveryAddresses);

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
            type: 'SELF',
            fullName: null,
            phone: null,
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
                type: 'OTHER',
                fullName: faker.person.fullName(),
                phone: fakerEN_IN.phone.number({ style: 'international' }),
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


        const availableProducts = products.filter(p => p.storeId === store.storeId);
        const orderItemsCount = faker.number.int({ min: 1, max: Math.min(5, availableProducts.length) });

        const orderItems = faker.helpers.arrayElements(availableProducts, orderItemsCount)
            .map(product => ({
                productId: product.productId,
                price: product.price,
                quantity: faker.number.int({ min: 1, max: 10 })
            }));

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
            orderStatusId: faker.string.uuid(),
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
    const productRatingsMap = {}; // To track ratings per product
    const reviewedPairs = new Set(); // To avoid duplicate (customerId, productId) reviews

    for (const order of orders) {
        const completedStatuses = orderStatusList.slice(orderStatusList.indexOf("Shipped"));
        if (!completedStatuses.includes(order.orderStatus)) continue;

        const items = orderItemsData.filter((item) => item.orderId === order.orderId);

        for (const item of items) {
            const reviewKey = `${order.customerId}:${item.productId}`;

            if (reviewedPairs.has(reviewKey)) continue; // Skip if already reviewed
            reviewedPairs.add(reviewKey);

            // 70% chance this user rates this product
            if (faker.datatype.boolean({ probability: 0.7 })) {
                const rating = faker.number.int({ min: 1, max: 5 });
                const hasReviewText = faker.datatype.boolean({ probability: 0.6 });

                reviews.push({
                    reviewId: faker.string.uuid(),
                    productId: item.productId,
                    customerId: order.customerId,
                    rating,
                    review: hasReviewText ? faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })) : null,
                    isVisible: true,
                    created_at: faker.date.recent(90),
                    updated_at: new Date(),
                });

                if (!productRatingsMap[item.productId]) {
                    productRatingsMap[item.productId] = [];
                }
                productRatingsMap[item.productId].push(rating);
            }
        }
    }

    await knex("product_reviews").insert(reviews);
    console.log(`Inserted ${reviews.length} unique product reviews.`);

// Update rating aggregates
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

    console.log("Seeding store reviews...");

    const storeReviews = [];
    const storeRatingsMap = {}; // To track ratings per store
    const reviewedStorePairs = new Set(); // To avoid duplicate (customerId, storeId) reviews

    for (const order of orders) {
        const completedStatuses = orderStatusList.slice(orderStatusList.indexOf("Shipped"));
        if (!completedStatuses.includes(order.orderStatus)) continue;

        // Each order is for one store, so we can directly use the storeId
        const reviewKey = `${order.customerId}:${order.storeId}`;

        if (reviewedStorePairs.has(reviewKey)) continue; // Skip if customer already reviewed this store
        reviewedStorePairs.add(reviewKey);

        // 70% chance this user rates this store
        if (faker.datatype.boolean({ probability: 0.7 })) {
            const rating = faker.number.int({ min: 1, max: 5 });
            const hasReviewText = faker.datatype.boolean({ probability: 0.6 });

            storeReviews.push({
                reviewId: faker.string.uuid(),
                storeId: order.storeId,
                customerId: order.customerId,
                rating,
                review: hasReviewText ? faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })) : null,
                isVisible: true,
                created_at: faker.date.recent(90),
                updated_at: new Date(),
            });

            if (!storeRatingsMap[order.storeId]) {
                storeRatingsMap[order.storeId] = [];
            }
            storeRatingsMap[order.storeId].push(rating);
        }
    }

    await knex("store_reviews").insert(storeReviews);
    console.log(`Inserted ${storeReviews.length} unique store reviews.`);

// Update store rating aggregates
    for (const [storeId, ratings] of Object.entries(storeRatingsMap)) {
        const total = ratings.reduce((sum, r) => sum + r, 0);
        const avg = (total / ratings.length).toFixed(2);
        await knex("stores")
            .where({ storeId })
            .update({
                rating: avg,
                numberOfRatings: ratings.length,
            });
    }

    console.log("Store ratings updated.");

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