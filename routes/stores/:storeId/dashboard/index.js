// routes/dashboard/index.js

'use strict';

const knex = require("@database/knexInstance");
const { getCompletedOrderStatuses } = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
    fastify.get('/', async function (request, reply) {
        const { storeId } = request.user;
        if (!storeId) return reply.status(400).send({ error: "Missing storeId" });

        const completedStatuses = getCompletedOrderStatuses();

        // Fetch store info
        const store = await knex('stores').where({ storeId }).first();

        // Banners
        const banners = {
            isActive: store.isActive,
            noProducts: false,
            noOrders: false,
        };

        // Product inventory stats
        const productCounts = await knex('products')
            .where({ storeId })
            .count('productId as total')
            .count(knex.raw("CASE WHEN isActive THEN 1 END as active"))
            .count(knex.raw("CASE WHEN NOT isActive THEN 1 END as inactive"))
            .first();

        // Check if store has any products
        banners.noProducts = Number(productCounts.total) === 0;

        // Order stats
        const allOrders = await knex('orders')
            .where({ storeId });

        banners.noOrders = allOrders.length === 0;

        const today = new Date();
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const completedOrdersToday = allOrders.filter(o =>
            completedStatuses.includes(o.orderStatus) &&
            new Date(o.orderDate) >= startOfToday
        );
        const salesToday = completedOrdersToday.reduce((sum, o) => sum + Number(o.orderTotal), 0);
        const newOrdersToday = allOrders.filter(o =>
            new Date(o.orderDate) >= startOfToday
        ).length;

        const quickStats = {
            openOrders: allOrders.filter(o => !completedStatuses.includes(o.orderStatus)).length,
            newOrdersToday,
            salesToday,
        };

        // Chart Data — Last 7 days & 4 weeks
        const past7Days = [...Array(7)].map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toISOString().slice(0, 10);
        });

        const chartData = {
            sales: {
                week: past7Days.map(date => {
                    const total = allOrders
                        .filter(o => o.orderDate.toISOString().slice(0, 10) === date)
                        .filter(o => completedStatuses.includes(o.orderStatus))
                        .reduce((sum, o) => sum + Number(o.orderTotal), 0);
                    return { date, total };
                }),
                month: [0, 1, 2, 3].map(weekOffset => {
                    const now = new Date();
                    const start = new Date(now);
                    start.setDate(start.getDate() - (7 * (weekOffset + 1)));
                    const end = new Date(now);
                    end.setDate(end.getDate() - (7 * weekOffset));

                    const total = allOrders
                        .filter(o => {
                            const d = new Date(o.orderDate);
                            return d >= start && d < end && completedStatuses.includes(o.orderStatus);
                        })
                        .reduce((sum, o) => sum + Number(o.orderTotal), 0);

                    return { label: `Week ${4 - weekOffset}`, total };
                })
            },
            orders: {
                week: past7Days.map(date => {
                    const count = allOrders
                        .filter(o => o.orderDate.toISOString().slice(0, 10) === date)
                        .length;
                    return { date, count };
                }),
                month: [0, 1, 2, 3].map(weekOffset => {
                    const now = new Date();
                    const start = new Date(now);
                    start.setDate(start.getDate() - (7 * (weekOffset + 1)));
                    const end = new Date(now);
                    end.setDate(end.getDate() - (7 * weekOffset));

                    const count = allOrders
                        .filter(o => {
                            const d = new Date(o.orderDate);
                            return d >= start && d < end;
                        }).length;

                    return { label: `Week ${4 - weekOffset}`, count };
                })
            }
        };

        // Top Products (by total orderTotal)
        const topProducts = await knex('orderItems')
            .join('products', 'orderItems.productId', 'products.productId')
            .join('orders', 'orderItems.orderId', 'orders.orderId')
            .where('orders.storeId', storeId)
            .andWhere('orders.orderStatus', 'in', completedStatuses)
            .groupBy('products.productId', 'products.productName')
            .select('products.productId', 'products.productName')
            .sum('orderItems.quantity as totalQuantity')
            .sum('orderItems.total as totalSales')
            .orderBy('totalSales', 'desc')
            .limit(5);

        // Top Customers (by total spend)
        const topCustomers = await knex('orders')
            .join('customers', 'orders.customerId', 'customers.customerId')
            .where('orders.storeId', storeId)
            .andWhere('orders.orderStatus', 'in', completedStatuses)
            .groupBy('customers.customerId', 'customers.fullName')
            .select('customers.customerId', 'customers.fullName')
            .sum('orders.orderTotal as totalSpent')
            .orderBy('totalSpent', 'desc')
            .limit(5);

        return reply.send({
            banners,
            quickStats,
            chartData,
            productInventory: {
                total: Number(productCounts.total),
                active: Number(productCounts.active),
                inactive: Number(productCounts.inactive),
            },
            topProducts,
            topCustomers,
        });
    });
};