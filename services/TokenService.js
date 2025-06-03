const crypto = require('crypto');
const knex = require("@database/knexInstance");
const jwt = require('jsonwebtoken');
const {decode} = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

const TokenService = {
// Generate JWT

    generateAccessToken(payload) {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '1m' }); // Short-lived access token
    },

    generateRefreshToken(payload) {
        return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '1d' }); // Long-lived refresh token
    },

    verifyAccessToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            throw new Error('Invalid or expired token:', error);
        }
    },

    verifyRefreshToken(token) {
        try {
            return jwt.verify(token, JWT_REFRESH_SECRET);
        } catch (error) {
            throw new Error('Invalid or expired token:', error);
        }
    },

    async storeRefreshToken(userId, refreshToken, expiresAt) {
        const tokenHash = hashToken(refreshToken);
        await knex('refresh_tokens').insert({
            userId: userId,
            tokenHash: tokenHash,
            expires_at: expiresAt,
        });
    },

    async checkRefreshToken(userId, refreshToken) {
        const tokenHash = hashToken(refreshToken);
        const token = await knex('refresh_tokens')
            .where({
                userId: userId,
                tokenHash: tokenHash,
            })
            .andWhere('expires_at', '>', new Date())
            .first();

        return token !== undefined;
    },

    async deleteRefreshToken(userId, refreshToken) {
        const tokenHash = hashToken(refreshToken);
        await knex('refresh_tokens')
            .where({
                userId: userId,
                tokenHash: tokenHash,
            })
            .del();
    },

    async deleteAllRefreshTokensForUser(userId) {
        await knex('refresh_tokens')
            .where({
                userId: userId,
            })
            .del();
    },
    async replyWithAuthTokens(reply, merchant, stores){
        // Create payload (e.g., customerId or merchantId)
        const payload = { merchantId: merchant.merchantId};

        const accessToken = this.generateAccessToken(payload);
        const refreshToken = this.generateRefreshToken({ userId: merchant.merchantId });
        // Decode new refresh token to get expiresAt
        const decodedRefreshToken = decode(refreshToken);
        const expiresAt = new Date(decodedRefreshToken.exp * 1000); // Convert `exp` to milliseconds

        // Store refresh token in database (or in-memory store)
        await this.storeRefreshToken(merchant.merchantId, refreshToken, expiresAt); // Example: Save to DB

        // Return tokens (access token in response, refresh token in HTTP-only cookie)
        reply.status(200)
            .setCookie('refreshToken', refreshToken, {
                httpOnly: true, // Prevent client-side access
                secure: true, // Use HTTPS in production
                path: '/auth', // Restrict usage
                sameSite: 'Strict', // Prevent CSRF attacks
            })
            .send({ accessToken, merchant, stores });

    }
};

module.exports = TokenService;