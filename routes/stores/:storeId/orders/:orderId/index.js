'use strict'

const knex = require("@database/knexInstance");
const validateMerchantAccessToStore = require("../../../../../utils/validateMerchantAccessToStore");

module.exports = async function (fastify, opts) {
    fastify.get('/', async (request, reply) => {
        const { storeId, orderId } = request.params;

        try {
            // Validate the merchant's access to the store
            const merchantId = request.user.merchantId; // Assumes user data is attached to the request
            const hasAccess = await validateMerchantAccessToStore(merchantId, storeId);
            if (!hasAccess) {
                return reply.status(403).send({ error: 'Unauthorized access to this store.' });
            }

            // Fetch the order details
            const order = await knex('orders')
                .where({ orderId, storeId })
                .first();

            if (!order) {
                return reply.status(404).send({ error: 'Order not found.' });
            }

            // Fetch the customer details
            const customer = await knex('customers')
                .where({ customerId: order.customerId })
                .first();

            if (!customer) {
                return reply.status(404).send({ error: 'Customer not found.' });
            }

            // Fetch the order items with product details
            const orderItems = await knex('order_items as oi') // Assuming an `order_items` table
                .join('products as p', 'oi.productId', 'p.productId')
                .where({ orderId })
                .select(
                    'oi.productId',
                    'oi.quantity',
                    'p.productName',
                    'p.description',
                    'p.price',
                    'p.mediaItems'
                );

            // Combine the data into a single response
            const response = {
                ...order,
                customer: {
                    customerId: customer.customerId,
                    fullName: customer.fullName,
                    address: customer.address,
                    phoneNumber: customer.phoneNumber,
                    email: customer.email,
                },
                orderItems,
            };

            return reply.send(response);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch order details.' });
        }
    });

}
