const {orderStatusList} = require("../../utils/orderStatusList");

exports.up = async function (knex) {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    // Create `merchants` table
    await knex.schema.createTable('merchants', (table) => {
        table.uuid('merchantId').primary();
        table.string('fullName').notNullable();
        table.string('phone').unique().notNullable();
        table.timestamps(true, true);
    });

    // Create `stores` table
    await knex.schema.createTable("stores", function (table) {
        table.uuid("storeId").primary();
        table.string("storeName").notNullable();
        table.string("storeLogoImage").nullable();
        table.text("storeDescription").notNullable();
        table.string('storeHandle').unique().notNullable(); // Add storeHandle column, must be unique
        table.integer('followerCount').defaultTo(0); // Add followerCount column with a default value of 0
        table.jsonb("storeTags").defaultTo("[]");
        table.decimal('rating').defaultTo(0);
        table.integer('numberOfRatings').notNullable().defaultTo(0);
        table.boolean("isActive").defaultTo(false);
        table.timestamps(true, true);
    });

    // Create `merchantStores` table
    await knex.schema.createTable('merchantStores', (table) => {
        table.uuid('merchantStoreId').primary();
        table.uuid('merchantId').references('merchantId').inTable('merchants').onDelete('CASCADE');
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.enum('merchantRole', ['Admin', 'Manager', 'Staff']).notNullable();
        table.boolean('canReceiveMessages').defaultTo(true);
        table.timestamps(true, true);
    });

    await knex.schema.createTable('storeSettings', (table) => {
        table.uuid('storeId').primary().references('storeId').inTable('stores').onDelete('CASCADE');
        table.boolean('defaultGstInclusive').defaultTo(true);
        table.integer('defaultGstRate').defaultTo(18); // allowed values: [0, 5, 12, 18, 28]
        table.timestamps(true, true);
    });

    // Create `collections` table
    await knex.schema.createTable("collections", function (table) {
        table.uuid("collectionId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.string("collectionName").notNullable();
        table.boolean("isActive").defaultTo(true);
        table.boolean("storeFrontDisplay").defaultTo(true);
        table.integer("storeFrontDisplayNumberOfItems").defaultTo(4);
        table.integer("displayOrder").defaultTo(0);
        table.timestamps(true, true);
    });

    // Create `products` table
    await knex.schema.createTable("products", function (table) {
        table.uuid("productId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.string("productName").notNullable();
        table.text("description").nullable();
        table.decimal("price", 10, 2).notNullable();
        table.integer("stock").notNullable();
        table.integer("reservedStock").notNullable().defaultTo(0);
        table.decimal('gstRate').notNullable().defaultTo(0);
        table.boolean('gstInclusive').notNullable().defaultTo(false);
        table.decimal('rating').defaultTo(0);
        table.integer('numberOfRatings').notNullable().defaultTo(0);
        table.jsonb("productTags").defaultTo("[]");
        table.jsonb("attributes").defaultTo("[]");
        table.jsonb("mediaItems").defaultTo("[]");
        table.boolean("isActive").defaultTo(true);
        table.timestamps(true, true);
    });

    // Create `productCollections` table
    await knex.schema.createTable("productCollections", function (table) {
        table.increments("id").primary();
        table.uuid("productId").notNullable().references("productId").inTable("products").onDelete("CASCADE");
        table.uuid("collectionId").notNullable().references("collectionId").inTable("collections").onDelete("CASCADE");
        table.integer("displayOrder").defaultTo(0);
        table.timestamps(true, true);
    });

    // Create `variantGroups` table
    await knex.schema.createTable("variantGroups", (table) => {
        table.uuid("variantGroupId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.string("name").notNullable();
        table.timestamps(true, true);
    });

    // Create `productVariants` table
    await knex.schema.createTable("productVariants", (table) => {
        table.uuid("productVariantId").primary();
        table.uuid("productId").notNullable().references("productId").inTable("products").onDelete("CASCADE");
        table.uuid("variantGroupId").notNullable().references("variantGroupId").inTable("variantGroups").onDelete("CASCADE");
        table.jsonb("differingAttributes").notNullable();
        table.timestamps(true, true);
        table.unique(["productId", "variantGroupId"]);
    });

    // Create `customers` table
    await knex.schema.createTable("customers", function (table) {
        table.uuid("customerId").primary();
        table.string("customerHandle").unique().notNullable();
        table.string("fullName").notNullable();
        table.string("email").nullable();
        table.string("phone").notNullable().unique();
        table.timestamps(true, true);
    });

    await knex.schema.createTable("razorpay_oauth_states", function (table) {
        table.uuid("id").primary().defaultTo(knex.raw('gen_random_uuid()')); // Or use auto-incrementing integer if preferred
        table.string("state").unique().notNullable().index(); // Unique state string, indexed
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE") // If store is deleted, cascade delete related oauth states.index(); // Index for faster lookups by storeId
        table.timestamp("expires_at", { useTz: true }).notNullable().index(); // Expiration timestamp, indexed
        table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now()); // Creation timestamp
    });

    await knex.schema.createTable("razorpay_accounts", function (table) {
        table.uuid("id").primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid("storeId").notNullable().unique()
            .references("storeId")
            .inTable("stores")
            .onDelete("CASCADE") // If store is deleted, cascade delete the Razorpay link
            .index();
        table.string("razorpayAccountId").notNullable().unique().index(); // Merchant's actual RZP Account ID
        // Store as TEXT as encrypted tokens can be long
        table.text("accessToken").notNullable(); // Should always have an access token on creation
        table.text("refreshToken").nullable(); // Refresh token might not always be provided
        table.timestamp("tokenExpiresAt", { useTz: true }).nullable(); // Expiration might not always be provided or relevant (e.g., if using refresh tokens heavily)
        table.text("grantedScopes").nullable(); // Store granted scopes
        table.timestamps(true, true); // Adds createdAt and updatedAt columns
    });

    await knex.schema.createTable('otp_verification', function(table) {
        table.increments('otpId').primary();
        table.string('phone', 15).notNullable().index(); // E.164 international format recommended
        table.string('otp', 10).notNullable();
        table.string('context', 50).notNullable();
        table.enum('app', ['marketplace', 'merchant']).notNullable();
        table.boolean('isVerified').defaultTo(false);
        table.integer('attemptCount').defaultTo(0);
        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Optional: useful for analytics / abuse tracking
        // table.string('request_id'); // If using a 3rd party OTP provider
        // table.string('ip_address');
        // table.string('user_agent');
    });

    // Create `deliveryAddresses` table
    await knex.schema.createTable("deliveryAddresses", function (table) {
        table.uuid("addressId").primary();
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.string("street1").notNullable();
        table.string("street2").nullable();
        table.string("city").notNullable();
        table.string("state").notNullable();
        table.string("country").notNullable();
        table.string("postalCode").notNullable();
        table.timestamps(true, true);
    });
    // Create recipients table
    await knex.schema.createTable("recipients", function (table) {
        table.uuid("recipientId").primary();
        table.enum("type", ["SELF", "OTHER"]).notNullable().defaultTo("OTHER");
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.string("fullName").nullable();
        table.string("phone").nullable();
        table.boolean("isDefaultRecipient").defaultTo(false); // Default recipient for the customer
        table.timestamps(true, true);
    });
    // Add check constraint for SELF type fields
    await knex.raw(`
        ALTER TABLE recipients
        ADD CONSTRAINT check_self_recipient_null_fields
        CHECK (
            (type = 'SELF' AND "fullName" IS NULL AND phone IS NULL) OR
            (type = 'OTHER' AND "fullName" IS NOT NULL AND phone IS NOT NULL)
        )
    `);

    // Add unique constraint to ensure only one SELF recipient per customer
    await knex.raw(`
        CREATE UNIQUE INDEX unique_self_recipient_per_customer
            ON recipients ("customerId")
            WHERE type = 'SELF'
    `);


    await knex.schema.createTable("recipientAddresses", function (table) {
        table.uuid("recipientAddressId").primary();
        table.uuid("recipientId").notNullable().references("recipientId").inTable("recipients").onDelete("CASCADE");
        table.uuid("addressId").notNullable().references("addressId").inTable("deliveryAddresses").onDelete("CASCADE");
        table.boolean("isDefault").defaultTo(false); // Default address for the recipient
        table.timestamps(true, true);
    });

    // Create `customer_followed_stores` table
    await knex.schema.createTable('customer_followed_stores', function (table) {
        table.uuid('customerId').notNullable().references('customerId').inTable('customers').onDelete('CASCADE');
        table.uuid('storeId').notNullable().references('storeId').inTable('stores').onDelete('CASCADE');
        table.timestamp('followed_at').defaultTo(knex.fn.now());
        table.primary(['customerId', 'storeId']);
    });

    await knex.schema.createTable("product_reviews", function (table) {
        table.uuid("reviewId").primary();
        table.uuid("productId").notNullable().references("productId").inTable("products").onDelete("CASCADE");
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.integer("rating").notNullable().checkBetween([1, 5]); // 1 to 5
        table.text("review").nullable(); // Optional review text
        table.boolean("isVisible").defaultTo(true); // For moderation
        table.timestamps(true, true);
        table.unique(["productId", "customerId"]); // Prevent duplicate reviews
    });

    await knex.schema.createTable("store_reviews", function (table) {
        table.uuid("reviewId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.integer("rating").notNullable().checkBetween([1, 5]); // 1 to 5
        table.text("review").nullable(); // Optional review text
        table.boolean("isVisible").defaultTo(true); // For moderation
        table.timestamps(true, true);
        table.unique(["storeId", "customerId"]); // Prevent duplicate reviews
    });

    // Create `orders` table
    await knex.schema.createTable("orders", function (table) {
        table.uuid("orderId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.enum("orderStatus", orderStatusList).defaultTo("Order Created");
        table.timestamp("orderStatusUpdateTime").defaultTo(knex.fn.now());
        table.jsonb("recipient").defaultTo("{}");
        table.jsonb("deliveryAddress").defaultTo("{}");
        table.decimal("orderTotal", 10, 2).notNullable();
        table.timestamp("orderDate").defaultTo(knex.fn.now());
        table.string('paymentId').nullable().index(); // Add nullable paymentId column, index optional
        table.timestamps(true, true);
    });

    // Create `order_status_history` table
    await knex.schema.createTable("order_status_history", function (table) {
        table.uuid("orderStatusId").primary();
        table.uuid("orderId").notNullable().references("orderId").inTable("orders").onDelete("CASCADE");
        table.enum("orderStatus", orderStatusList).notNullable();
        table.text('notes').nullable(); // Add nullable text column for notes
        table.timestamps(true, true);
    });

    // Create `order_items` table
    await knex.schema.createTable("order_items", function (table) {
        table.increments("id").primary();
        table.uuid("orderId").notNullable().references("orderId").inTable("orders").onDelete("CASCADE");
        table.uuid("productId").notNullable().references("productId").inTable("products").onDelete("CASCADE");
        table.decimal("price", 10, 2).notNullable();
        table.integer("quantity").notNullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('razorpay_order_mapping', function(table) {
        // Using default Knex incrementing primary key for simplicity unless you prefer UUIDs everywhere
        table.increments('mappingId').primary();
        // Razorpay Order IDs look like 'order_ABC123XYZ', typically < 40 chars
        table.string('razorpayOrderId', 40).notNullable().index(); // Index for fast webhook lookups
        table.uuid('platformOrderId').notNullable(); // Your internal order ID
        table.foreign('platformOrderId') // Define Foreign Key constraint
            .references('orderId')
            .inTable('orders')
            .onDelete('CASCADE'); // If an order is deleted, cascade delete the mapping
        table.timestamps(true, true); // Adds created_at and updated_at
        // Index on platformOrderId might be useful for other lookups
        table.index('platformOrderId');
    });


    await knex.schema.createTable("customer_carts", (table) => {
        table.uuid("customerId").primary().references("customerId").inTable("customers").onDelete("CASCADE");
        table.jsonb("cartData").notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('customer_cart_checkouts', (table) => {
        table.uuid('checkoutId').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('customerId').notNullable().references('customerId').inTable('customers').onDelete('CASCADE');
        table.text('cartSummaryHash').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['customerId', 'cartSummaryHash'], 'uniq_customer_cart_hash');
    });

    // Create `offers` table
    await knex.schema.createTable('offers', (table) => {
        table.uuid('offerId').primary();
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.string('offerName').notNullable();
        table.string('offerDisplayText').notNullable();
        table.string('offerCode').nullable();
        table.boolean('requireCode').defaultTo(false);
        table.enum('offerType', ['Percentage Off', 'Fixed Amount Off', 'Buy N Get K Free', 'Free Shipping']).notNullable();
        table.jsonb('discountDetails').notNullable();
        table.jsonb('applicableTo').notNullable();
        table.jsonb('conditions').nullable();
        table.jsonb('validityDateRange').notNullable();
        table.boolean('isActive').defaultTo(true);
        table.timestamps(true, true);
    });

    await knex.schema.createTable("shipping_rules", function (table) {
        table.uuid("shippingRuleId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.string("ruleName").notNullable();
        table.jsonb("conditions").notNullable().defaultTo('[]');
        table.boolean("groupingEnabled").notNullable().defaultTo(false);
        table.boolean("isActive").defaultTo(true);
        table.timestamps(true, true);

        // ✅ Index for faster store lookups
        table.index(["storeId"], "idx_shipping_rules_store");
    });

    await knex.schema.createTable("product_shipping_rules", function (table) {
        table.uuid("assignmentId").primary();
        table.uuid("productId").notNullable().references("productId").inTable("products").onDelete("CASCADE");
        table.uuid("shippingRuleId").notNullable().references("shippingRuleId").inTable("shipping_rules").onDelete("CASCADE");
        table.timestamps(true, true);

        // ✅ Enforce 1 product → 1 shipping rule assignment
        table.unique(["productId"], "idx_product_shipping_rules_unique_product");

        // ✅ Normal indexes for joins
        table.index(["shippingRuleId"], "idx_product_shipping_rules_shippingRuleId");
    });


    await knex.schema.createTable('customer_saved_items', (table) => {
        table.uuid('id').primary();
        table.uuid('customerId').notNullable().references('customerId').inTable('customers').onDelete('CASCADE');
        table.uuid('productId').notNullable().references('productId').inTable('products').onDelete('CASCADE');
        table.timestamp('saved_at').defaultTo(knex.fn.now());

        table.unique(['customerId', 'productId']); // Prevent duplicate saved items
    });

    await knex.schema.createTable('chats', (table) => {
        table.uuid('chatId').primary();
        table.uuid('customerId').references('customerId').inTable('customers').onDelete('CASCADE');
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.boolean('isActive').defaultTo(true); // For soft-deleting or archiving chats
        table.timestamps(true, true);
        table.unique(['customerId', 'storeId']);
        table.index(['customerId', 'storeId']);

    });

    await knex.schema.createTable('messages', (table) => {
        table.uuid('messageId').primary();
        table.uuid('chatId').references('chatId').inTable('chats').onDelete('CASCADE');
        table.uuid('senderId').notNullable(); // Can be a `customerId` or `merchantId`
        table.enum('senderType', ['Customer', 'Merchant']).notNullable(); // Distinguish sender type
        table.text('message').notNullable(); // The message content
        table.timestamps(true, true);
        table.index(['chatId', 'senderId', 'senderType']);
    });

    await knex.schema.createTable('message_reads', (table) => {
        table.uuid('messageReadId').primary();
        table.uuid('messageId').references('messageId').inTable('messages').onDelete('CASCADE'); // Message reference
        table.uuid('readerId').notNullable(); // Can be a customerId or merchantId
        table.enum('readerType', ['Customer', 'Merchant']).notNullable(); // Specify if the reader is a customer or a merchant
        table.timestamp('read_at').notNullable(); // Timestamp of when the message was read
        table.unique(['messageId', 'readerId']); // Ensure one record per reader-message combination
    });

    await knex.schema.createTable('refresh_tokens', (table) => {
        table.increments('id').primary(); // Auto-incrementing primary key
        table.uuid('userId').notNullable(); // User ID associated with the token
        table.text('tokenHash').notNullable(); // Hashed refresh token
        table.timestamp('expires_at').notNullable(); // Expiration date of the token
        table.timestamps(true, true); // created_at and updated_at
    });

    await knex.schema.createTable('customerNotificationPreferences', function(table) {
        table.uuid('customerId').primary().references('customerId').inTable('customers').onDelete('CASCADE');

        table.boolean('muteAll').defaultTo(false);
        table.boolean('orderStatus').defaultTo(true);
        table.boolean('orderDelivery').defaultTo(true);
        table.boolean('chatMessages').defaultTo(true);
        table.boolean('miscellaneous').defaultTo(true);


        table.timestamps(true, true);
    });

    await knex.schema.createTable('merchantNotificationPreferences', function(table) {
        table.uuid('merchantId').references('merchantId').inTable('merchants').onDelete('CASCADE');
        table.uuid('storeId').notNullable().references('stores.storeId').onDelete('CASCADE');
        table.primary(['merchantId', 'storeId']);
        table.boolean('muteAll').defaultTo(false);
        table.boolean('newOrders').defaultTo(true);
        table.boolean('chatMessages').defaultTo(true);
        table.boolean('returnRequests').defaultTo(true);
        table.boolean('orderCancellations').defaultTo(true);
        table.boolean('miscellaneous').defaultTo(true);
        table.boolean('ratingsAndReviews').defaultTo(true);
        table.boolean('newFollowers').defaultTo(true);

        table.timestamps(true, true);
    });

    // Create customerPushTokens table
    await knex.schema.createTable("customerPushTokens", function (table) {
        table.uuid("pushTokenId").primary();
        table
            .uuid("customerId")
            .notNullable()
            .references("customerId")
            .inTable("customers")
            .onDelete("CASCADE");
        table.text("expoPushToken").notNullable();
        table.jsonb("deviceInfo").nullable(); // optional device info like model, platform, version
        table.timestamps(true, true); // createdAt, updatedAt

        table.index(["customerId"]);
        table.unique(["customerId", "expoPushToken"]);
    });

    // Create merchantPushTokens table
    await knex.schema.createTable("merchantPushTokens", function (table) {
        table.uuid("pushTokenId").primary();
        table
            .uuid("merchantId")
            .notNullable()
            .references("merchantId")
            .inTable("merchants")
            .onDelete("CASCADE");
        table.text("expoPushToken").notNullable();
        table.jsonb("deviceInfo").nullable();
        table.timestamps(true, true);

        table.index(["merchantId"]);
        table.unique(["merchantId", "expoPushToken"]);
    });

    // Add full-text and GIN indexes for `products`
    await knex.schema.alterTable('products', (table) => {
        table.index(
            knex.raw(`to_tsvector('english', coalesce("productName", '') || ' ' || coalesce("description", ''))`),
            'idx_products_productName_description',
            'GIN'
        );
    });

    await knex.raw(`
    CREATE INDEX idx_products_productTags ON products USING gin("productTags");
    CREATE INDEX idx_products_attributes ON products USING gin(attributes);
  `);

    // Add full-text and GIN indexes for `stores`
    await knex.schema.alterTable('stores', (table) => {
        table.index(
            knex.raw(`to_tsvector('english', coalesce("storeName", '') || ' ' || coalesce("storeDescription", ''))`),
            'idx_stores_storeName_description',
            'GIN'
        );
    });

    await knex.raw(`
    CREATE INDEX idx_stores_storeTags ON stores USING gin("storeTags");
  `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("customerNotificationPreferences");
    await knex.schema.dropTableIfExists("merchantNotificationPreferences");
    await knex.schema.dropTableIfExists("merchantPushTokens");
    await knex.schema.dropTableIfExists("customerPushTokens");
    await knex.schema.dropTableIfExists('refresh_tokens');
    await knex.schema.dropTableIfExists('message_reads');
    await knex.schema.dropTableIfExists('messages');
    await knex.schema.dropTableIfExists('chats');
    await knex.schema.dropTableIfExists('customer_saved_items');
    await knex.schema.dropTableIfExists("product_shipping_rules");
    await knex.schema.dropTableIfExists("shipping_rules");
    await knex.schema.dropTableIfExists("offers");
    await knex.schema.dropTableIfExists("razorpay_oauth_states");
    await knex.schema.dropTableIfExists("razorpay_order_mapping");
    await knex.schema.dropTableIfExists("razorpay_accounts");
    await knex.schema.dropTableIfExists("order_items");
    await knex.schema.dropTableIfExists("order_status_history");
    await knex.schema.dropTableIfExists("orders");
    await knex.schema.dropTableIfExists("product_reviews");
    await knex.schema.dropTableIfExists("store_reviews");
    await knex.schema.dropTableIfExists("customer_followed_stores");
    await knex.schema.dropTableIfExists("recipientAddresses");
    await knex.schema.dropTableIfExists("recipients");
    await knex.schema.dropTableIfExists("deliveryAddresses");
    await knex.schema.dropTableIfExists("otp_verification");
    await knex.schema.dropTableIfExists("customer_cart_checkouts");
    await knex.schema.dropTableIfExists("customer_carts");
    await knex.schema.dropTableIfExists("customers");
    await knex.schema.dropTableIfExists("productVariants");
    await knex.schema.dropTableIfExists("variantGroups");
    await knex.schema.dropTableIfExists("productCollections");
    await knex.schema.dropTableIfExists("products");
    await knex.schema.dropTableIfExists("collections");
    await knex.schema.dropTableIfExists("merchantStores");
    await knex.schema.dropTableIfExists("storeSettings");
    await knex.schema.dropTableIfExists("stores");
    await knex.schema.dropTableIfExists("merchants");
    await knex.raw('DROP EXTENSION IF EXISTS "pgcrypto";');
};