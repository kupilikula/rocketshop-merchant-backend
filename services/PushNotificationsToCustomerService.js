// services/sendNotificationToCustomer.js

const { Expo } = require('expo-server-sdk');
const expo = new Expo();
const knex = require('@database/knexInstance');

// ----------------------
// Constants
// ----------------------

const CustomerNotificationTypes = {
    ORDER_STATUS_UPDATED: ({orderId, newStatus}) => ({
        type: 'ORDER_STATUS_UPDATED',
        title: 'Order Status Updated',
        body: `New order status is ${newStatus}`,
        data: { orderId },
    }),
    ORDER_DELIVERED: ({orderId}) => ({
        type: 'ORDER_DELIVERED',
        title: 'Order Delivered',
        body: 'Enjoy your purchase!',
        data: { orderId },
    }),
    ORDER_CANCELED: ({orderId}) => ({
        type: 'ORDER_CANCELED',
        title: 'Order Canceled',
        body: 'Your order was canceled by the store',
        data: { orderId },
    }),
    NEW_MESSAGE: ({storeId, storeName}) => ({
        type: 'NEW_MESSAGE',
        title: 'New Message',
        body: `You have a new message from ${storeName}`,
        data: { storeId },
    }),
    PROMOTION: ({promotionId, promoText}) => ({
        type: 'PROMOTION',
        title: 'New Promotion',
        body: promoText,
        data: { promotionId },
    }),
};

const NotificationChannels = {
    CUSTOMER: {
        ORDER_STATUS: 'order-status',
        ORDER_DELIVERY: 'order-delivery',
        CHAT: 'chat',
        PROMOTIONS: 'promotions',
    },
};

// ----------------------
// Preference Check
// ----------------------

async function shouldNotifyCustomer(customerId, notificationType) {
    const prefs = await knex('customerNotificationPreferences')
        .where({ customerId })
        .first();

    if (!prefs) return true;
    if (prefs.muteAll) return false;

    switch (notificationType) {
        case 'ORDER_STATUS_UPDATED':
        case 'ORDER_CANCELED':
            return prefs.orderStatus;
        case 'ORDER_DELIVERED':
            return prefs.orderDelivery;
        case 'NEW_MESSAGE':
            return prefs.messages;
        case 'PROMOTION':
            return prefs.promotions;
        default:
            return true;
    }
}

// ----------------------
// Main Notification Sender
// ----------------------

/**
 * Sends a typed notification to the customer (if not muted)
 * @param {string} customerId
 * @param {function} notificationTemplateFunction - one of NotificationTypes.<TYPE>
 * @param  {object} data - arguments passed to the template function
 */
async function checkPreferencesAndSendNotificationToCustomer(customerId, notificationTemplateFunction, data) {

    try {
    const messagePayload = notificationTemplateFunction(data);
    const { type } = messagePayload;
    console.log(`Checking and Sending notification of type ${type} to customerId ${customerId}`);
    const allow = await shouldNotifyCustomer(customerId, type);
    console.log(`Notification of type ${type} allowed: ${allow}`);
    if (!allow) {
        console.log(`Notification of type ${type} skipped for customerId ${customerId}`);
        return;
    }

    // Get push tokens
    const tokens = await knex('customerPushTokens')
        .where({ customerId })
        .distinct('expoPushToken');

    if (!tokens.length) {
        console.log(`No push tokens found for customerId ${customerId}`);
        return;
    }

    // Determine channelId
    let channelId = undefined;
    switch (type) {
        case 'ORDER_STATUS_UPDATED':
        case 'ORDER_CANCELED':
            channelId = NotificationChannels.CUSTOMER.ORDER_STATUS;
            break;
        case 'ORDER_DELIVERED':
            channelId = NotificationChannels.CUSTOMER.ORDER_DELIVERY;
            break;
        case 'NEW_MESSAGE':
            channelId = NotificationChannels.CUSTOMER.CHAT;
            break;
        case 'PROMOTION':
            channelId = NotificationChannels.CUSTOMER.PROMOTIONS;
            break;
    }

    // Build and send messages
    const messages = tokens
        .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
        .map((t) => ({
            to: t.expoPushToken,
            title: messagePayload.title,
            body: messagePayload.body,
            data: messagePayload.data,
            sound: 'default',
            channelId,
        }));

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
        } catch (err) {
            console.error('Error sending push notifications to customer:', err);
        }
    }

    console.log(`Sent push notifications to customerId ${customerId}`, tickets);
    } catch (error) {
        console.error("Error sending notifications: ", error);
    }
}

// ----------------------

module.exports = {
    checkPreferencesAndSendNotificationToCustomer,
    CustomerNotificationTypes,
    NotificationChannels,
};