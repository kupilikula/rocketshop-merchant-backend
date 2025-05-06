// routes/oauth/razorpayCallback.js (Example path)
'use strict';

// App's custom scheme and the path you want the deep link handler to match
const APP_SCHEME = 'rocketshopmerchant';
const APP_CALLBACK_PATH = 'razorpay/callback'; // e.g., results in rocketshopmerchant://razorpay/callback

module.exports = async function (fastify) {

    // This route path MUST match the Redirect URI registered with Razorpay
    fastify.get('/', async (request, reply) => {
        // Use the Fastify instance logger
        const logger = fastify.log;
        const { code, state, error, error_description } = request.query;

        logger.info({ query: request.query }, "Received callback redirect from Razorpay.");

        // --- Check for errors returned directly from Razorpay ---
        if (error) {
            logger.error({ error, error_description, state }, "Razorpay authorization failed.");
            const appErrorUrl = new URL(`${APP_SCHEME}://${APP_CALLBACK_PATH}`);
            appErrorUrl.searchParams.append('error', error);
            if (error_description) {
                appErrorUrl.searchParams.append('error_description', error_description);
            }
            if (state) { // Pass state back if available, for context
                appErrorUrl.searchParams.append('state', state);
            }
            appErrorUrl.searchParams.append('status', 'error'); // Add status

            const redirectTarget = appErrorUrl.toString();
            logger.info(`Redirecting to App with error: ${redirectTarget}`);
            // Perform the redirect back to the app
            return reply.redirect(302, redirectTarget);
        }

        // --- Handle successful authorization (code and state expected) ---
        if (!code || !state) {
            // This shouldn't happen on success, but handle defensively
            logger.error({ query: request.query }, "Callback from Razorpay missing code or state on success.");
            const appErrorUrl = new URL(`${APP_SCHEME}://${APP_CALLBACK_PATH}`);
            appErrorUrl.searchParams.append('error', 'missing_parameters');
            appErrorUrl.searchParams.append('error_description', 'Required code or state missing in Razorpay callback.');
            if (state) {
                appErrorUrl.searchParams.append('state', state); // Include state if only code was missing
            }
            appErrorUrl.searchParams.append('status', 'error');

            logger.info(`Redirecting to App with error: ${appErrorUrl.toString()}`);
            return reply.redirect(302, appErrorUrl.toString());
        }

        // --- Success: Construct the app scheme URL with code and state ---
        const appSuccessUrl = new URL(`${APP_SCHEME}://${APP_CALLBACK_PATH}`);
        appSuccessUrl.searchParams.append('code', code);
        appSuccessUrl.searchParams.append('state', state);
        appSuccessUrl.searchParams.append('status', 'success'); // Indicate success

        const redirectTarget = appSuccessUrl.toString();
        logger.info(`Redirecting to App successfully: ${redirectTarget}`);

        // --- Issue the 302 Redirect to the App ---
        return reply.redirect(302, redirectTarget);
    });
};