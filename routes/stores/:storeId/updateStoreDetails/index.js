// PATCH /stores/:storeId/updateStoreDetails

const knex = require("@database/knexInstance");

module.exports = async function (fastify, opts) {
    fastify.patch('/', async (request, reply) => {
        const { storeId } = request.params;
        const { storeName, storeHandle, storeDescription, storeTags, storeLogoImage } = request.body;

        if (!storeName && !storeHandle && !storeDescription && !storeTags && !storeLogoImage) {
            return reply.status(400).send({ error: "At least one field must be provided for update." });
        }

        const updatePayload = {};

        if (storeName) updatePayload.storeName = storeName;
        if (storeDescription) updatePayload.storeDescription = storeDescription;
        if (storeTags) updatePayload.storeTags = JSON.stringify(storeTags);
        if (storeLogoImage) updatePayload.storeLogoImage = storeLogoImage;

        if (storeHandle) {
            const existingHandle = await knex("stores")
                .whereNot({ storeId })
                .andWhere({ storeHandle })
                .first();

            if (existingHandle) {
                return reply.status(400).send({ error: "Store Handle already taken" });
            }

            updatePayload.storeHandle = storeHandle;
        }

        updatePayload.updated_at = knex.fn.now();

        await knex("stores")
            .where({ storeId })
            .update(updatePayload);

        return reply.status(200).send({ success: true });
    });
};