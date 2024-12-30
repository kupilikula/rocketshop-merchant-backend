const orderStatusList = require("../../utils/orderStatusList");

exports.up = async function(knex) {
    await knex.schema.createTable('merchants', (table) => {
        table.uuid('merchantId').primary(); // Primary key
        table.string('merchantName').notNullable(); // Merchant's name
        table.string('merchantPhone').unique().notNullable(); // Phone number, unique
        table.enum('merchantRole', ['Admin', 'Manager', 'Staff']).notNullable(); // Role
        table.timestamps(true, true); // Timestamps
    });

    await knex.schema.createTable("stores", function(table) {
        table.uuid("storeId").primary();
        table.string("storeName").notNullable();
        table.string("storeLogoImage").nullable();
        table.string("storeBrandColor").nullable();
        table.text("storeDescription").notNullable();
        table.jsonb("storeTags").defaultTo("[]");
        table.timestamps(true, true);
    });

    await knex.schema.createTable('merchantStores', (table) => {
        table.uuid('merchantStoreId').primary(); // Primary key
        table.uuid('merchantId').references('merchantId').inTable('merchants').onDelete('CASCADE'); // FK to merchants
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE'); // FK to stores
        table.enum('role', ['Admin', 'Manager', 'Staff']).notNullable(); // Role for this merchant in this store
        table.timestamps(true, true); // Timestamps
    });

    await knex.schema.createTable("collections", function(table) {
        table.uuid("collectionId").primary();
        table.uuid("storeId").notNullable();
        table.string("collectionName").notNullable();
        table.boolean("isActive").defaultTo(false);
        table.boolean("storeFrontDisplay").defaultTo(false);
        table.integer("storeFrontDisplayNumberOfItems").defaultTo(0);
        table.integer("displayOrder").defaultTo(0);
        table.timestamps(true, true);

        table.foreign("storeId").references("stores.storeId").onDelete("CASCADE");
    });

    await knex.schema.createTable("products", function(table) {
        table.uuid("productId").primary();
        table.uuid("storeId").notNullable();
        table.string("productName").notNullable();
        table.text("description").nullable();
        table.decimal("price", 10, 2).notNullable();
        table.integer("stock").notNullable();
        table.jsonb("productTags").defaultTo("[]"); // Array of tags
        table.jsonb("attributes").defaultTo("[]"); // Array of tags
        table.jsonb("mediaItems").defaultTo("[]"); // Storing mediaItems as JSON
        table.boolean("isActive").defaultTo(false);
        table.integer("displayOrder").defaultTo(0);
        table.timestamps(true, true);

        table.foreign("storeId").references("stores.storeId").onDelete("CASCADE");
    });

    await knex.schema.createTable("productCollections", function(table) {
        table.increments("id").primary();
        table.uuid("productId").notNullable();
        table.uuid("collectionId").notNullable();
        table.integer("displayOrder").defaultTo(0);
        table.timestamps(true, true);
        table.foreign("productId").references("products.productId").onDelete("CASCADE");
        table.foreign("collectionId").references("collections.collectionId").onDelete("CASCADE");
    });

    await knex.schema.createTable("customers", function(table) {
        table.uuid("customerId").primary();
        table.string("fullName").notNullable();
        table.string("email").nullable();
        table.string("phone").nullable();
        table.string("customerAddress").nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable("orders", function(table) {
        table.uuid("orderId").primary();
        table.uuid("storeId").notNullable();
        table.uuid("customerId").notNullable();
        table.enum("orderStatus", orderStatusList).defaultTo("Order Received");
        table.timestamp("orderStatusUpdateTime").defaultTo(knex.fn.now());
        table.decimal("orderTotal", 10, 2).notNullable();
        table.timestamp("orderDate").defaultTo(knex.fn.now());
        table.timestamps(true, true);

        table.foreign("storeId").references("stores.storeId").onDelete("CASCADE");
        table.foreign("customerId").references("customers.customerId").onDelete("CASCADE");
    });

    await knex.schema.createTable("order_status_history", function(table) {
        table.increments("id").primary();
        table.uuid("orderId").notNullable();
        table.enum("status", orderStatusList).notNullable();
        table.timestamps(true, true);

        table.foreign("orderId").references("orders.orderId").onDelete("CASCADE");
    });

    await knex.schema.createTable("order_items", function(table) {
        table.increments("id").primary();
        table.uuid("orderId").notNullable();
        table.uuid("productId").notNullable();
        table.decimal("price", 10, 2).notNullable();
        table.integer("quantity").notNullable();
        table.timestamps(true, true);
        table.foreign("orderId").references("orders.orderId").onDelete("CASCADE");
        table.foreign("productId").references("products.productId").onDelete("CASCADE");
    });

    await knex.schema.createTable('offers', (table) => {
        table.uuid('offerId').primary();
        table.uuid('storeId').references('storeId').inTable('stores').onDelete('CASCADE');
        table.string('offerName').notNullable();
        table.text('offerDescription').nullable();
        table.enum('offerType', ['Percentage Off', 'Fixed Amount Off', 'Buy N Get K Free', 'Free Shipping']).notNullable();
        table.jsonb('discountDetails').notNullable(); // E.g., {"percentage": 10} or {"fixedAmount": 50}
        table.jsonb('applicableTo').notNullable(); // E.g., {"products": [...], "collections": [...], "tags": [...]}
        table.jsonb('conditions').nullable(); // E.g., {"minimumPurchaseAmount": 100, "minimumItems": 2}
        table.jsonb('validityDateRange').notNullable();
        table.boolean('isActive').defaultTo(true);
        table.timestamps(true, true);
    });
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists("offers");
    await knex.schema.dropTableIfExists("order_items");
    await knex.schema.dropTableIfExists("order_status_history");
    await knex.schema.dropTableIfExists("orders");
    await knex.schema.dropTableIfExists("productCollections");
    await knex.schema.dropTableIfExists("products");
    await knex.schema.dropTableIfExists("collections");
    await knex.schema.dropTableIfExists("customers");
    await knex.schema.dropTableIfExists("merchantStores");
    await knex.schema.dropTableIfExists("stores");
    await knex.schema.dropTableIfExists("merchants");
};