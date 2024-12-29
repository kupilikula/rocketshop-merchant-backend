exports.up = async function (knex) {

    // Create stores table
    await knex.schema.createTable('stores', (table) => {
        table.increments('storeId').primary();
        table.string('storeName', 100).notNullable();
        table.text('storeDescription');
        table.jsonb('storeTags');
        table.text('storeLogoImage');
        table.string('storeColor', 7);
        table.boolean('isActive').defaultTo(true);
    });

    // Create merchants table
    await knex.schema.createTable('merchants', (table) => {
        table.increments('merchantId').primary();
        table.integer('storeId').unsigned().notNullable().references('storeId').inTable('stores');
        table.string('phoneNumber', 15).notNullable();
        table.string('email', 100);
        table.string('role', 10).notNullable(); // admin or non-admin
    });

    // Create products table
    await knex.schema.createTable('products', (table) => {
        table.increments('productId').primary();
        table.integer('storeId').unsigned().notNullable().references('storeId').inTable('stores');
        table.string('productName', 100).notNullable();
        table.text('description');
        table.decimal('price', 10, 2).notNullable();
        table.integer('stock').notNullable();
        table.jsonb('collectionIds');
        table.jsonb('productTags');
        table.jsonb('attributes');
        table.decimal('gstRate', 4, 2);
        table.boolean('gstInclusive').defaultTo(false);
        table.decimal('rating', 3, 2).defaultTo(0);
        table.integer('numberOfRatings').defaultTo(0);
        table.jsonb('mediaItemIds');
        table.boolean('isActive').defaultTo(true);
    });

    // Create collections table
    await knex.schema.createTable('collections', (table) => {
        table.increments('collectionId').primary();
        table.string('collectionName', 100).notNullable();
        table.text('collectionDescription');
        table.jsonb('collectionTags');
        table.boolean('storeFrontDisplay').defaultTo(false);
        table.integer('storeFrontDisplayNumberOfItems').defaultTo(0);
        table.boolean('isActive').defaultTo(true);
    });

    // Create mediaItems table
    await knex.schema.createTable('mediaItems', (table) => {
        table.increments('mediaId').primary();
        table.string('mediaType', 10).notNullable(); // image or video
        table.string('orientation', 10).defaultTo('landscape'); // image or video
        table.text('uri').notNullable();
        table.jsonb('cropParameters').defaultTo({scale: 1, translateX: 0, translateY: 0})
        table.text('thumbnailUri');
    });

    // Create customers table
    await knex.schema.createTable('customers', (table) => {
        table.increments('customerId').primary();
        table.string('fullName', 100).notNullable();
        table.text('address');
        table.string('phoneNumber', 15).notNullable();
        table.string('email', 100).notNullable();
    });

    // Create orders table
    await knex.schema.createTable('orders', (table) => {
        table.increments('orderId').primary();
        table.integer('storeId').unsigned().notNullable().references('storeId').inTable('stores');
        table.timestamp('orderDate').defaultTo(knex.fn.now());
        table.integer('customerId').unsigned().notNullable().references('customerId').inTable('customers');
        table.jsonb('orderItems').notNullable();
        table.string('orderCurrentStatus', 20).notNullable();
        table.timestamp('orderCurrentStatusUpdateTimestamp').defaultTo(knex.fn.now());
        table.decimal('orderSubTotal', 10, 2).notNullable();
        table.decimal('gst', 10, 2).notNullable();
        table.decimal('discount', 10, 2).defaultTo(0);
        table.decimal('shipping', 10, 2).defaultTo(0);
        table.decimal('orderTotal', 10, 2).notNullable();
    });

    // Create offers table
    await knex.schema.createTable('offers', (table) => {
        table.increments('offerId').primary();
        table.integer('storeId').unsigned().notNullable().references('storeId').inTable('stores');
        table.string('offerName', 100).notNullable();
        table.text('description');
        table.string('offerCode', 50);
        table.boolean('requireCode').defaultTo(false);
        table.string('offerType', 20).notNullable();
        table.jsonb('discountDetails').notNullable();
        table.jsonb('applicableTo').notNullable();
        table.jsonb('conditions').notNullable();
        table.jsonb('validityDateRange').notNullable();
        table.boolean('isActive').defaultTo(true);
    });
};

exports.down = async function (knex) {
    // Drop tables in reverse order to avoid foreign key conflicts
    await knex.schema.dropTableIfExists('offers');
    await knex.schema.dropTableIfExists('orders');
    await knex.schema.dropTableIfExists('customers');
    await knex.schema.dropTableIfExists('mediaItems');
    await knex.schema.dropTableIfExists('collections');
    await knex.schema.dropTableIfExists('products');
    await knex.schema.dropTableIfExists('merchants');
    await knex.schema.dropTableIfExists('stores');

};