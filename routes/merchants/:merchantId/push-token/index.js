// For customer app or merchant app — choose one version per app

const knex = require('@database/knexInstance');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (fastify) {
    fastify.post("/", async (request, reply) => {
            const { expoPushToken, deviceInfo } = request.body;
            const {merchantId} = request.user;
            // Detect app context (customer or merchant)

            if (!merchantId) {
                return reply.code(401).send({ error: "Invalid user context" });
            }

            try {
                if (merchantId) {
                    const existing = await knex("merchantPushTokens")
                        .where({ merchantId, expoPushToken })
                        .first();
                    if (existing) {
                        await knex("merchantPushTokens")
                            .where({ pushTokenId: existing.pushTokenId })
                            .update({ updated_at: knex.fn.now(), deviceInfo });
                } else {
                        await knex("merchantPushTokens").insert({
                            pushTokenId: uuidv4(),
                            merchantId,
                            expoPushToken,
                            deviceInfo,
                        });
                    }
                }

                return reply.code(200).send({ success: true });
            } catch (err) {
                request.log.error(err);
                return reply.code(500).send({ error: "Failed to register push token" });
            }
        },
    );
};