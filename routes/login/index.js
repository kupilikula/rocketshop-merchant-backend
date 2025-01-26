'use strict'

const knex = require("@database/knexInstance");
const {generateJWT} = require("../../utils/jwt");
const {generateAccessToken, generateRefreshToken, storeRefreshToken} = require("../../services/TokenService");
const {decode} = require("jsonwebtoken");

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

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken({ userId: merchantId });
        // Decode new refresh token to get expiresAt
        const decodedRefreshToken = decode(refreshToken);
        const expiresAt = new Date(decodedRefreshToken.exp * 1000); // Convert `exp` to milliseconds

        // Store refresh token in database (or in-memory store)
        await storeRefreshToken(merchantId, refreshToken, expiresAt); // Example: Save to DB

        // Return tokens (access token in response, refresh token in HTTP-only cookie)
        reply.status(200)
            .setCookie('refreshToken', refreshToken, {
                httpOnly: true, // Prevent client-side access
                secure: true, // Use HTTPS in production
                path: '/refreshToken', // Restrict usage
                sameSite: 'Strict', // Prevent CSRF attacks
            })
            .send({ accessToken, merchant, store });

    });
}
