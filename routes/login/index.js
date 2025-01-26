'use strict'

const knex = require("@database/knexInstance");
const {generateJWT} = require("../../utils/jwt");

module.exports = async function (fastify, opts) {
    fastify.post('/', async function (request, reply) {
        const { phone, otp, storeIndex } = request.body;

        // Validate user credentials here (e.g., check in database)
        const isValid = true; // Replace with actual validation logic

        if (!isValid) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        let i = storeIndex || 0;
        let row = await knex('merchantStores')
            .select('merchantId', 'storeId')
            .offset(i)
            .first(); // Get a single row directly

        if (!row) {
            throw new Error('No row found at the specified index');
        }

// Extract merchantId and storeId from the row
        const { merchantId, storeId } = row;

// Get the full merchant and store rows
        let [merchant, store] = await Promise.all([
            knex('merchants').where({ merchantId }).first(),
            knex('stores').where({ storeId }).first(),
        ]);

        // Create payload (e.g., customerId or merchantId)
        const payload = { merchantId: merchantId };

        // Generate JWT
        const token = generateJWT(payload);



        let result = { token, merchant, store };

        reply.status(200).send(result);
    });
}
