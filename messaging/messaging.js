const knex = require("@database/knexInstance");
const { verifyAccessToken } = require("../services/TokenService");
// Active connections map (if needed)
const activeUsers = new Map();

/**
 * Initialize Socket.IO for real-time messaging
 * @param {object} io - The Socket.IO instance
 * @param {object} app - The Fastify app instance (for logging or shared context)
 */
function initMessaging(io, app) {
    // Middleware for token validation on all events
    io.use((socket, next) => {
        try {
            // Extract the token from the `auth` object
            const token = socket.handshake.auth.accessToken;
            if (!token) {
                app.log.error("No token provided for WebSocket connection");
                return next(new Error("Unauthorized"));
            }

            // Verify the token
            const user = verifyAccessToken(token);
            if (!user) {
                app.log.error("Invalid token for WebSocket connection");
                return next(new Error("Unauthorized"));
            }

            // Attach the user object to the socket for later use
            socket.user = user;
            app.log.info(`WebSocket connection authenticated: ${socket.id} for user ${JSON.stringify(user)}`);
            next(); // Proceed with the connection
        } catch (error) {
            app.log.error(`Error during WebSocket authentication: ${error.message}`);
            return next(new Error("Unauthorized"));
        }
    });

    // Handle WebSocket connections
    io.on("connection", (socket) => {
        app.log.info(`WebSocket connection established: ${socket.id} for user ${JSON.stringify(socket.user)}`);

        // Join a chat room
        socket.on("joinChat", ({ chatId, userId, userType }) => {
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
        socket.on("sendMessage", async (messageData) => {
            const { chatId, messageId, senderId, senderType, message } = messageData;
            console.log("sendMessage:", messageData);
            try {
                app.log.info(`Sender socket ID: ${socket.id} sent a message`);

                // Save the message to the database
                const newMessage = await saveMessageToDatabase(chatId, messageId, senderId, senderType, message);
                // Log all clients in the room
                const clients = io.sockets.adapter.rooms.get(chatId);
                app.log.info(`Clients in room ${chatId}: ${clients ? [...clients] : "No clients"}`);

                // Broadcast the message to all clients in the room except the sender
                io.to(chatId).except(socket.id).emit("receiveMessage", newMessage);

                // Emit `newMessage` event to **all sockets** except those belonging to the sender
                io.sockets.sockets.forEach((socketInstance) => {
                    let userId = senderType==='Merchant' ? socketInstance.user?.merchantId : socketInstance.user?.customerId;
                    console.log('line77 senderId: ', senderId, ', socketInstance id:', socketInstance.id, ' , user:', socketInstance.user);
                    if (userId !== senderId) {
                        console.log('emitting newMessage to socketInstance id:', socketInstance.id, ' with user:', socketInstance.user);
                        socketInstance.emit("newMessage", {
                            chatId,
                            senderId,
                            senderType,
                            message: newMessage.message,
                            messageId: newMessage.messageId,
                            created_at: newMessage.created_at,
                        });
                    }
                });

                // Optionally log the message sent
                app.log.info(`Message sent in chat ${chatId} by ${senderId}: ${message}`);
            } catch (error) {
                app.log.error(`Error saving message: ${error.message}`);
                socket.emit("error", { error: "Message could not be sent" });
            }
        });

        socket.on("messageRead", ({ chatId, messageId, readerId }) => {
            console.log("messageRead, messageId:", messageId, " , readerID:", readerId);
            // Notify the sender
            io.to(chatId).except(socket.id).emit("messageRead", { messageId, readerId });
        });

        socket.on("typing", ({ chatId, senderId }) => {
            console.log("typing, senderId:", senderId);
            io.to(chatId).except(socket.id).emit("typing", { senderId });
        });

        socket.on("stopTyping", ({ chatId, senderId }) => {
            console.log("stop typing, senderId:", senderId);
            io.to(chatId).except(socket.id).emit("stopTyping", { senderId });
        });

        // Handle disconnections
        socket.on("disconnect", () => {
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
async function saveMessageToDatabase(chatId, messageId, senderId, senderType, messageContent) {
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