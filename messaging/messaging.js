const { Server } = require('socket.io')
const knex = require("@database/knexInstance");


// Active connections map (if needed)
const activeUsers = new Map()

/**
 * Initialize Socket.IO for real-time messaging
 * @param {object} server - The HTTP server
 * @param {object} app - The Fastify app instance (for logging or shared context)
 */
function initMessaging(server, app) {
    const io = new Server(server, {
        cors: {
            origin: '*', // Replace with your frontend's origin
            methods: ['GET', 'POST']
        }
    })

    // Handle WebSocket connections
    io.on('connection', (socket) => {
        app.log.info(`WebSocket connection established: ${socket.id}`)

        // Join a chat room
        socket.on('joinChat', ({ chatId, userId, userType }) => {
            activeUsers.set(socket.id, { chatId, userId, userType })
            socket.join(chatId)
            app.log.info(`User ${userId} (${userType}) joined chat ${chatId}`)
        })

        // Handle sending messages
        socket.on('sendMessage', async (messageData) => {
            const { chatId, senderId, senderType, message } = messageData

            try {
                // Save the message to the database
                const newMessage = await saveMessageToDatabase(chatId, senderId, senderType, message)

                // Broadcast the message to the chat room
                io.to(chatId).emit('receiveMessage', newMessage)
                app.log.info(`Message sent in chat ${chatId} by ${senderId}: ${message}`)
            } catch (error) {
                app.log.error(`Error saving message: ${error.message}`)
                socket.emit('error', { error: 'Message could not be sent' })
            }
        })

        socket.on('typing', ({ chatId, userId }) => {
            socket.to(chatId).emit('typing', { chatId, userId });
        });

        // Handle disconnections
        socket.on('disconnect', () => {
            const user = activeUsers.get(socket.id)
            if (user) {
                app.log.info(`User ${user.userId} disconnected from chat ${user.chatId}`)
                activeUsers.delete(socket.id)
            }
        })
    })
}

/**
 * Helper function to save a message to the database
 */
async function saveMessageToDatabase(chatId, senderId, senderType, messageContent) {

    const [newMessage] = await knex('messages')
        .insert({
            chatId,
            senderId,
            senderType,
            message: messageContent
        })
        .returning(['messageId', 'chatId', 'senderId', 'senderType', 'message', 'created_at'])
    return newMessage
}

module.exports = initMessaging