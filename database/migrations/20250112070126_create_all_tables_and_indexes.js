const orderStatusList = require("../../utils/orderStatusList");

exports.up = async function (knex) {
    // Create `merchants` table
    await knex.schema.createTable('merchants', (table) => {
        table.uuid('merchantId').primary();
        table.string('merchantName').notNullable();
        table.string('merchantPhone').unique().notNullable();
        table.enum('merchantRole', ['Admin', 'Manager', 'Staff']).notNullable();
        table.timestamps(true, true);
    });

    // Create `stores` table
    await knex.schema.createTable("stores", function (table) {
        table.uuid("storeId").primary();
        table.string("storeName").notNullable();
        table.string("storeLogoImage").nullable();
        table.string("storeBrandColor").nullable();
        table.text("storeDescription").notNullable();
        table.string('storeHandle').unique().notNullable(); // Add storeHandle column, must be unique
        table.integer('followerCount').defaultTo(0); // Add followerCount column with a default value of 0
        table.jsonb("storeTags").defaultTo("[]");
        table.boolean("isActive").defaultTo(true);
        table.timestamps(true, true);
    });

    // Create `merchantStores` table
    await knex.schema.createTable('merchantStores', (table) => {
        table.uuid('merchantStoreId').primary();
        table.uuid('merchantId').references('merchantId').inTable('merchants').onDelete('CASCADE');
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.enum('role', ['Admin', 'Manager', 'Staff']).notNullable();
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
        table.boolean('enableRatings').notNullable().defaultTo(true);
        table.boolean('enableReviews').notNullable().defaultTo(true);
        table.boolean('enableStockTracking').notNullable().defaultTo(true);
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

    // Step 1: Create `customers` table without the `defaultAddressId` column
    await knex.schema.createTable("customers", function (table) {
        table.uuid("customerId").primary();
        table.string("customerHandle").unique().notNullable();
        table.string("fullName").notNullable();
        table.string("email").nullable();
        table.string("phone").nullable();
        table.timestamps(true, true);
    });

    // Step 2: Create `deliveryAddresses` table
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

    // Step 3: Add `defaultAddressId` column to `customers` table
    await knex.schema.alterTable("customers", function (table) {
        table.uuid("defaultAddressId").nullable().references("addressId").inTable("deliveryAddresses").onDelete("SET NULL");
    });
    // Create recipients table
    await knex.schema.createTable("recipients", function (table) {
        table.uuid("recipientId").primary();
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.string("fullName").notNullable();
        table.string("phone").notNullable();
        table.uuid("addressId").notNullable().references("addressId").inTable("deliveryAddresses").onDelete("CASCADE");
        table.boolean("isDefaultRecipient").defaultTo(false); // Indicate if this is the default recipient
        table.timestamps(true, true);
    });

    // Create `customer_followed_stores` table
    await knex.schema.createTable('customer_followed_stores', function (table) {
        table.uuid('customerId').notNullable().references('customerId').inTable('customers').onDelete('CASCADE');
        table.uuid('storeId').notNullable().references('storeId').inTable('stores').onDelete('CASCADE');
        table.timestamp('followed_at').defaultTo(knex.fn.now());
        table.primary(['customerId', 'storeId']);
    });

    // Create `orders` table
    await knex.schema.createTable("orders", function (table) {
        table.uuid("orderId").primary();
        table.uuid("storeId").notNullable().references("storeId").inTable("stores").onDelete("CASCADE");
        table.uuid("customerId").notNullable().references("customerId").inTable("customers").onDelete("CASCADE");
        table.enum("orderStatus", orderStatusList).defaultTo("Order Received");
        table.timestamp("orderStatusUpdateTime").defaultTo(knex.fn.now());
        table.decimal("orderTotal", 10, 2).notNullable();
        table.timestamp("orderDate").defaultTo(knex.fn.now());
        table.timestamps(true, true);
    });

    // Create `order_status_history` table
    await knex.schema.createTable("order_status_history", function (table) {
        table.increments("id").primary();
        table.uuid("orderId").notNullable().references("orderId").inTable("orders").onDelete("CASCADE");
        table.enum("orderStatus", orderStatusList).notNullable();
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

    // Create `offers` table
    await knex.schema.createTable('offers', (table) => {
        table.uuid('offerId').primary();
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.string('offerName').notNullable();
        table.text('offerDescription').nullable();
        table.enum('offerType', ['Percentage Off', 'Fixed Amount Off', 'Buy N Get K Free', 'Free Shipping']).notNullable();
        table.jsonb('discountDetails').notNullable();
        table.jsonb('applicableTo').notNullable();
        table.jsonb('conditions').nullable();
        table.jsonb('validityDateRange').notNullable();
        table.boolean('isActive').defaultTo(true);
        table.timestamps(true, true);
    });

    await knex.schema.createTable('customer_saved_items', (table) => {
        table.uuid('id').primary();
        table.uuid('customerId').notNullable().references('customerId').inTable('customers').onDelete('CASCADE');
        table.uuid('productId').notNullable().references('productId').inTable('products').onDelete('CASCADE');
        table.timestamp('saved_at').defaultTo(knex.fn.now());

        table.unique(['customerId', 'productId']); // Prevent duplicate saved items
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
    await knex.schema.dropTableIfExists('customer_saved_items');
    await knex.schema.dropTableIfExists("offers");
    await knex.schema.dropTableIfExists("order_items");
    await knex.schema.dropTableIfExists("order_status_history");
    await knex.schema.dropTableIfExists("orders");
    await knex.schema.dropTableIfExists("customer_followed_stores");
    await knex.schema.dropTableIfExists("recipients");
    await knex.schema.dropTableIfExists("deliveryAddresses");
    await knex.schema.dropTableIfExists("customers");
    await knex.schema.dropTableIfExists("productVariants");
    await knex.schema.dropTableIfExists("variantGroups");
    await knex.schema.dropTableIfExists("productCollections");
    await knex.schema.dropTableIfExists("products");
    await knex.schema.dropTableIfExists("collections");
    await knex.schema.dropTableIfExists("merchantStores");
    await knex.schema.dropTableIfExists("stores");
    await knex.schema.dropTableIfExists("merchants");
};