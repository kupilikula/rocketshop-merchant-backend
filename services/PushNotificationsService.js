// services/sendNotificationToCustomer.js

const { Expo } = require('expo-server-sdk');
const expo = new Expo();
const knex = require('@database/knexInstance');
/**
 * Sends a push notification to all devices registered by the customer
 * @param {object} knex - Your Knex instance
 * @param {string} customerId - The customer receiving the notification
 * @param {object} messagePayload - Push message object { title, body, data }
 */
async function sendNotificationToCustomer(customerId, messagePayload) {
    // Step 1: Get all push tokens for the customer
    const tokens = await knex('customerPushTokens')
        .where({ customerId })
        .select('expoPushToken')
        .distinct();

    if (!tokens.length) {
        console.log(`No push tokens found for customerId ${customerId}`);
        return;
    }

    // Step 2: Create messages for valid tokens
    const messages = tokens
        .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
        .map((t) => ({
            to: t.expoPushToken,
            sound: 'default',
            title: messagePayload.title,
            body: messagePayload.body,
            data: messagePayload.data || {},
        }));

    // Step 3: Send messages in chunks
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

    // Optional: log results
    console.log(`Sent push notifications to customerId ${customerId}`, tickets);
}

module.exports = { sendNotificationToCustomer };