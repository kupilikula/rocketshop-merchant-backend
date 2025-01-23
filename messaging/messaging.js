const knex = require("@database/knexInstance");
const { v4: uuidv4 } = require("uuid");
// Active connections map (if needed)
const activeUsers = new Map();

/**
 * Initialize Socket.IO for real-time messaging
 * @param {object} io - The Socket.IO instance
 * @param {object} app - The Fastify app instance (for logging or shared context)
 */
function initMessaging(io, app) {
    // Handle WebSocket connections
    io.on('connection', (socket) => {
        app.log.info(`WebSocket connection established: ${socket.id}`);

        // Join a chat room
        socket.on('joinChat', ({ chatId, userId, userType }) => {
            if (!chatId || !userId || !userType) {
                app.log.error(`Missing parameters in joinChat: chatId=${chatId}, userId=${userId}, userType=${userType}`);
                return;
            }

            socket.join(chatId); // Join the room for this chatId
            app.log.info(`User ${userId} (${userType}) joined chat ${chatId} with socket ID: ${socket.id}`);

            // Log current clients in the room
            const clients = io.sockets.adapter.rooms.get(chatId) || new Set();
            app.log.info(`Current clients in room ${chatId}: ${[...clients]}`);
        });

        // Handle sending messages
        socket.on('sendMessage', async (messageData) => {
            const { chatId, senderId, senderType, message } = messageData;

            try {
                app.log.info(`Sender socket ID: ${socket.id} sent a message`);

                // Save the message to the database
                const newMessage = await saveMessageToDatabase(chatId, senderId, senderType, message);
                // Log all clients in the room
                const clients = io.sockets.adapter.rooms.get(chatId);
                app.log.info(`Clients in room ${chatId}: ${clients ? [...clients] : 'No clients'}`);

                // Broadcast the message to all clients in the room except the sender
                io.to(chatId).except(socket.id).emit('receiveMessage', newMessage);

                // Optionally log the message sent
                app.log.info(`Message sent in chat ${chatId} by ${senderId}: ${message}`);
            } catch (error) {
                app.log.error(`Error saving message: ${error.message}`);
                socket.emit('error', { error: 'Message could not be sent' });
            }
        });

        // Typing indicator
        socket.on('typing', ({ chatId, userId }) => {
            socket.to(chatId).emit('typing', { chatId, userId });
        });

        // Handle disconnections
        socket.on('disconnect', () => {
            const user = activeUsers.get(socket.id);
            if (user) {
                app.log.info(`User ${user.userId} disconnected from chat ${user.chatId}`);
                activeUsers.delete(socket.id);
            }
        });
    });
}

/**
 * Helper function to save a message to the database
 */
async function saveMessageToDatabase(chatId, senderId, senderType, messageContent) {
    const messageId = uuidv4();
    const [newMessage] = await knex('messages')
        .insert({
            messageId,
            chatId,
            senderId,
            senderType,
            message: messageContent,
        })
        .returning(['messageId', 'chatId', 'senderId', 'senderType', 'message', 'created_at']);
    return newMessage;
}

module.exports = initMessaging;