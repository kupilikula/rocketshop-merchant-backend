exports.up = function (knex) {
    return knex.schema.createTable('merchants', (table) => {
        table.increments('merchantId').primary();
        table.string('name').notNullable();
        table.string('phone').unique().notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('merchants');
};