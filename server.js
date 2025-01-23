'use strict'

// Read the .env file.
require('dotenv').config()
require('module-alias/register')

// Require the framework
const Fastify = require('fastify')

// Require library to exit fastify process, gracefully (if possible)
const closeWithGrace = require('close-with-grace')

// Additional imports for WebSocket support
const http = require('http')

// Import messaging module
const initMessaging = require('./messaging/messaging') // Adjust path as needed

// Instantiate Fastify with some config
const app = Fastify({
    logger: true
})

// Create HTTP server and integrate Fastify
const server = http.createServer(app.server)

// Initialize WebSocket messaging
initMessaging(server, app)

// Register your application as a normal plugin.
const appService = require('./app.js')
app.register(appService)

// delay is the number of milliseconds for the graceful close to finish
closeWithGrace({ delay: process.env.FASTIFY_CLOSE_GRACE_DELAY || 500 }, async function ({ signal, err, manual }) {
    if (err) {
        app.log.error(err)
    }
    await app.close()
})

// Start listening.
app.listen({ port: process.env.PORT || 3000 }, (err) => {
    if (err) {
        app.log.error(err)
        process.exit(1)
    }
})