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
    io.use( async (socket, next) => {
        try {
            // Extract the token from the `auth` object
            const token = socket.handshake.auth.accessToken;
            const storeId = socket.handshake.auth.storeId; // undefined for customers

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
            if (user.merchantId) {
                // For merchant users, verify storeId is provided and valid
                if (!storeId) {
                    app.log.error("No storeId provided for merchant WebSocket connection");
                    return next(new Error("Unauthorized"));
                }

                socket.user = {
                    ...user,
                    storeId: storeId // Add storeId from auth
                };
                // Store the permission in the socket for later use
                socket.canReceiveMessages = await canMerchantReceiveMessages(user.merchantId, storeId);

            } else {
                socket.user = user;
            }



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

        // Helper function to check messaging permissions
        const messagingAllowed = () => {
            if (socket.user.merchantId && socket.canReceiveMessages === false) {
                socket.emit('error', {
                    error: 'Messaging is disabled for this store',
                    code: 'MESSAGING_DISABLED'
                });
                return false;
            }
            return true;
        };


        // Add the user and their socket to activeUsers
        const userId = socket.user.storeId || socket.user.customerId; // Adjust based on your user structure
        const userType = socket.user.storeId ? "Merchant" : "Customer";

        // Add the user's socket to activeUsers
        if (!activeUsers.has(userId)) {
            activeUsers.set(userId, new Set()); // Use a Set to store multiple sockets for the same user
        }
        activeUsers.get(userId).add(socket.id);

        app.log.info(`User ${userId} (${userType}) connected. Active sockets: ${[...activeUsers.get(userId)]}`);

        // Join a chat room
        socket.on("joinChat", ({ chatId, userId, userType }) => {
            if (!messagingAllowed()) {
                return;
            }

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
            if (!messagingAllowed()) {
                return;
            }
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

                // Determine the recipient's ID
                const recipientId = await getRecipientId(chatId, senderId, senderType);
                if (!recipientId) {
                    app.log.error(`Failed to identify recipient for chatId: ${chatId}`);
                    return;
                }
                // Notify all sockets of the recipient
                const recipientSockets = activeUsers.get(recipientId);
                console.log('recipientSockets for recipientId ', recipientId , ' : ', recipientSockets);
                if (recipientSockets) {
                    recipientSockets.forEach((socketId) => {
                        const recipientSocket = io.sockets.sockets.get(socketId);
                        if (recipientSocket) {
                            recipientSocket.emit("newMessage", {
                                chatId,
                                senderId,
                                senderType,
                                message: newMessage.message,
                                messageId: newMessage.messageId,
                                created_at: newMessage.created_at,
                            });
                            app.log.info(
                                `Sent newMessage event to socket ${socketId} for recipient ${recipientId}`
                            );
                        }
                    });
                } else {
                    app.log.info(`Recipient ${recipientId} has no active sockets.`);
                }

                // Optionally log the message sent
                app.log.info(`Message sent in chat ${chatId} by ${senderId}: ${message}`);
            } catch (error) {
                app.log.error(`Error saving message: ${error.message}`);
                socket.emit("error", { error: "Message could not be sent" });
            }
        });

        socket.on("messagesRead", ({ chatId, messageIds, readerId }) => {
            if (!messagingAllowed()) {
                return;
            }
            console.log("messagesRead event received for chatId:", chatId, ", messageIds:", messageIds, ", readerId:", readerId);

            if (!chatId || !messageIds || !readerId) {
                console.error("Missing parameters in messagesRead event.");
                return;
            }

            try {
                // Emit a single event with all the message IDs to all other clients in the chat room
                io.to(chatId).except(socket.id).emit("messagesRead", { chatId, messageIds, readerId });

                console.log(
                    `Emitted messagesRead event for chatId: ${chatId}, messageIds: ${messageIds}, readerId: ${readerId}`
                );
            } catch (error) {
                console.error("Error handling messagesRead event:", error);
            }
        });

        socket.on("typing", ({ chatId, senderId }) => {
            if (!messagingAllowed()) {
                return;
            }
            console.log("typing, senderId:", senderId);
            io.to(chatId).except(socket.id).emit("typing", { senderId });
        });

        socket.on("stopTyping", ({ chatId, senderId }) => {
            if (!messagingAllowed()) {
                return;
            }
            console.log("stop typing, senderId:", senderId);
            io.to(chatId).except(socket.id).emit("stopTyping", { senderId });
        });

        // Handle user disconnection
        socket.on("disconnect", () => {
            const userSockets = activeUsers.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id); // Remove the disconnected socket
                if (userSockets.size === 0) {
                    activeUsers.delete(userId); // Remove user from activeUsers if no sockets remain
                    app.log.info(`User ${userId} disconnected. Removed from active users.`);
                } else {
                    app.log.info(`Socket ${socket.id} disconnected for user ${userId}. Remaining sockets: ${[...userSockets]}`);
                }
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

async function getRecipientId(chatId, senderId, senderType) {
    try {
        // Query the database to fetch the chat participants
        const chat = await knex("chats")
            .select("storeId", "customerId")
            .where({ chatId })
            .first();

        if (!chat) {
            console.error(`Chat with ID ${chatId} not found.`);
            return null;
        }

        // Determine the recipient based on the sender's type
        if (senderType === "Merchant") {
            return chat.customerId; // Recipient is the customer
        } else if (senderType === "Customer") {
            return chat.storeId; // Recipient is the storeId for the merchant
        }

        console.error("Invalid senderType:", senderType);
        return null;
    } catch (error) {
        console.error("Error fetching recipient ID for chatId:", chatId, error);
        return null;
    }
}

// New helper function to check if merchant can receive messages
async function canMerchantReceiveMessages(merchantId, storeId) {
    try {
        const store = await knex('merchantStores')
            .select('canReceiveMessages')
            .where({
                merchantId: merchantId,
                storeId: storeId
            })
            .first();

        return store?.canReceiveMessages ?? false;
    } catch (error) {
        console.error('Error checking merchant message permissions:', error);
        return false;
    }
}


module.exports = initMessaging;