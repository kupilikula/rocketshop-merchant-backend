// routes/dashboard/index.js

'use strict';

const knex = require("@database/knexInstance");
const { getCompletedOrderStatuses, getInProgressOrderStatuses, getSalesEligibleOrderStatuses,
    getCanceledOrFailedOrderStatuses, getRefundedOrReturnedOrderStatuses
} = require("../../../../utils/orderStatusList");

module.exports = async function (fastify, opts) {
    fastify.get('/', async function (request, reply) {
        const { storeId } = request.params;
        if (!storeId) return reply.status(400).send({ error: "Missing storeId" });

        const now = new Date();

        // === Fetch Store Info ===
        const store = await knex('stores').where({ storeId }).first();
        if (!store) return reply.status(404).send({ error: "Store not found" });

        const createdAt = new Date(store.createdAt || store.created_at);
        const ageInDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

        // === Product Counts ===
        const productCounts = await knex("products")
            .where({ storeId })
            .count("productId as total")
            .count(knex.raw(`CASE WHEN "isActive" THEN 1 END`)).as("active")
            .count(knex.raw(`CASE WHEN NOT "isActive" THEN 1 END`)).as("inactive")
            .first();

        const totalProducts = Number(productCounts.total);
        const activeProducts = Number(productCounts.active);
        const inactiveProducts = Number(productCounts.inactive);

        // === Order Data ===
        const allOrders = await knex('orders').where({ storeId });
        const salesEligibleStatuses = getSalesEligibleOrderStatuses();
        const completedStatuses = getCompletedOrderStatuses();
        const inProgressStatuses = getInProgressOrderStatuses();
        const canceledOrFailedStatuses = getCanceledOrFailedOrderStatuses();
        const refundedOrReturnedStatuses = getRefundedOrReturnedOrderStatuses();

        const completedOrders = allOrders.filter(o => completedStatuses.includes(o.orderStatus));
        const inProgressOrders = allOrders.filter(o => inProgressStatuses.includes(o.orderStatus));
        const canceledOrFailedOrders = allOrders.filter(o => canceledOrFailedStatuses.includes(o.orderStatus));
        const refundedOrReturnedOrders = allOrders.filter(o => refundedOrReturnedStatuses.includes(o.orderStatus));
        const salesEligibleOrders = allOrders.filter(o => salesEligibleStatuses.includes(o.orderStatus));

        // === Situational Awareness ===
        const situations = {
            storeIsActive: store.isActive,

            // --- Products ---
            totalProducts,
            activeProducts,
            inactiveProducts,
            hasProducts: totalProducts > 0,
            hasActiveProducts: activeProducts > 0,
            hasInactiveProducts: inactiveProducts > 0,
            firstActiveProduct: activeProducts === 1, // ✅ updated
            firstInactiveProduct: inactiveProducts === 1 && activeProducts === 0,
            firstFewActiveProducts: activeProducts > 1 && activeProducts < 5,
            firstFewInactiveProducts: inactiveProducts > 1 && inactiveProducts < 5 && activeProducts === 0, // ✅ updated

            // --- Orders ---
            totalOrders: allOrders.length,
            completedOrders: completedOrders.length, // ✅ added
            inProgressOrders: inProgressOrders.length,
            canceledOrFailedOrders: canceledOrFailedOrders.length,
            refundedOrReturnedOrders: refundedOrReturnedOrders.length,

            firstCompletedOrder: completedOrders.length === 1,
            firstInProgressOrder: inProgressOrders.length === 1,
            firstOrder: allOrders.length === 1,
            firstFewOrders: allOrders.length > 1 && allOrders.length < 5,

            // --- Store Age ---
            storeAgeInDays: ageInDays,
            firstWeek: ageInDays < 7,
            firstMonth: ageInDays < 30,
            firstYear: ageInDays < 365,

        };

        // === Quick Stats (sales today based on sales-eligible statuses) ===
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        const salesToday = salesEligibleOrders
            .filter(o => new Date(o.orderDate) >= startOfToday)
            .reduce((sum, o) => sum + Number(o.orderTotal), 0);

        const newOrdersToday = allOrders.filter(o => new Date(o.orderDate) >= startOfToday).length;

        const quickStats = {
            openOrders: allOrders.filter(o => !completedStatuses.includes(o.orderStatus)).length,
            newOrdersToday,
            salesToday,
        };

        // === Charts (Sales and Orders) ===
        const past7Days = [...Array(7)].map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toISOString().slice(0, 10);
        });

        const chartData = {
            sales: {
                week: past7Days.map(date => {
                    const total = salesEligibleOrders
                        .filter(o => o.orderDate.toISOString().slice(0, 10) === date)
                        .reduce((sum, o) => sum + Number(o.orderTotal), 0);
                    return { date, total };
                }),
                month: [0, 1, 2, 3].map(weekOffset => {
                    const start = new Date(now);
                    const end = new Date(now);
                    start.setDate(now.getDate() - (7 * (weekOffset + 1)));
                    end.setDate(now.getDate() - (7 * weekOffset));

                    const total = salesEligibleOrders
                        .filter(o => {
                            const d = new Date(o.orderDate);
                            return d >= start && d < end;
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
                    const start = new Date(now);
                    const end = new Date(now);
                    start.setDate(now.getDate() - (7 * (weekOffset + 1)));
                    end.setDate(now.getDate() - (7 * weekOffset));

                    const count = allOrders
                        .filter(o => {
                            const d = new Date(o.orderDate);
                            return d >= start && d < end;
                        }).length;

                    return { label: `Week ${4 - weekOffset}`, count };
                })
            }
        };

        // === Top Products and Customers (unchanged) ===
        const topProducts = await knex
            .select('p.*', 't.totalQuantity', 't.totalSales')
            .from('products as p')
            .join(
                knex('order_items as oi')
                    .join('orders as o', 'oi.orderId', 'o.orderId')
                    .where('o.storeId', storeId)
                    .whereIn('o.orderStatus', completedStatuses)
                    .groupBy('oi.productId')
                    .select('oi.productId')
                    .sum('oi.quantity as totalQuantity')
                    .select(knex.raw('SUM(oi.price * oi.quantity) as "totalSales"'))
                    .as('t'),
                'p.productId',
                't.productId'
            )
            .orderBy('t.totalSales', 'desc')
            .limit(5);

        const topCustomers = await knex
            .select('c.*', 't.totalSpent', 't.orderCount', 't.mostRecentOrderDate')
            .from('customers as c')
            .join(
                knex('orders as o')
                    .where('o.storeId', storeId)
                    .whereIn('o.orderStatus', completedStatuses)
                    .groupBy('o.customerId')
                    .select('o.customerId')
                    .sum({ totalSpent: 'o.orderTotal' })
                    .count({ orderCount: 'o.orderId' })
                    .max('o.orderDate as mostRecentOrderDate')
                    .as('t'),
                'c.customerId',
                't.customerId'
            )
            .orderBy('t.totalSpent', 'desc')
            .limit(5);

        return reply.send({
            situations,
            quickStats,
            chartData,
            productInventory: {
                total: totalProducts,
                active: activeProducts,
                inactive: inactiveProducts,
            },
            topProducts,
            topCustomers,
        });
    });
};