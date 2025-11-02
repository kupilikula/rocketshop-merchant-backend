'use strict';

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async function (request, reply) {
        const { fullName, phone, otp } = request.body;
        const merchantId = request.user?.merchantId;

        if (!merchantId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        if (!fullName && !phone) {
            return reply.status(400).send({ error: 'Nothing to update' });
        }

        // If updating phone, we must validate OTP
        if (phone && otp) {
            const latestOtp = await knex('otp_verification')
                .where({ phone, app: 'merchant', context: 'UPDATE_PHONE' })
                .orderBy('created_at', 'desc')
                .first();

            if (!latestOtp || latestOtp.otp !== otp || !latestOtp.isVerified) {
                return reply.status(401).send({ error: 'Invalid or unverified OTP' });
            }
        }

        // Update fields
        const updatePayload = {};
        if (fullName) updatePayload.fullName = fullName;
        if (phone) updatePayload.phone = phone;

        const [updatedMerchant] = await knex('merchants')
            .where({ merchantId })
            .update(updatePayload)
            .returning('*');

        return reply.send({ success: true, merchant: updatedMerchant });
    });
};