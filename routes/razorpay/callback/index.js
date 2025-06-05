// routes/oauth/razorpayCallback.js
'use strict';

const APP_SCHEME = 'rocketshopmerchant';
const APP_DOMAIN_PATH = 'razorpay/callback'; // This is used as the "host" or "path" part in your app scheme URL
const WEB_APP_CALLBACK_PATH = '/razorpay/callback'; // The actual path for your web app callback

module.exports = async function (fastify) {
    fastify.get('/', async (request, reply) => {
        const logger = fastify.log;
        const { code, state, error, error_description } = request.query;

        logger.info({ query: request.query }, "Received callback redirect from Razorpay.");

        if (!state) {
            logger.error({ query: request.query }, "Critical: State parameter missing in Razorpay callback.");
            // Cannot determine redirect target without state, return a generic error
            return reply.code(400).send({ error: 'missing_state', error_description: 'State parameter is missing from the callback.' });
        }

        let determinedFrontendWebBaseUrl = null;
        let isWebFlow = false;

        // Determine if it's a web flow and the target base URL
        if (state.startsWith('web_local_')) {
            determinedFrontendWebBaseUrl = 'http://localhost:8081'; // Or your configured Expo dev port for web
            isWebFlow = true;
        } else if (state.startsWith('web_qa_')) {
            determinedFrontendWebBaseUrl = 'https://qa.merchant.rocketshop.in';
            isWebFlow = true;
        } else if (state.startsWith('web_production_')) {
            determinedFrontendWebBaseUrl = 'https://merchant.rocketshop.in';
            isWebFlow = true;
        } else if (state.startsWith('mobile_')) { // Explicitly check for mobile prefix
            isWebFlow = false; // It's a mobile flow
        } else {
            // State doesn't match known web prefixes or the mobile prefix
            logger.error({ state }, "Unrecognized state prefix received. Cannot determine redirect target.");
            return reply.code(400).send({ error: 'invalid_state_prefix', error_description: 'State parameter has an unrecognized prefix.' });
        }

        let targetRedirectUrl; // This will hold the final URL string

        // Prepare common query parameters to forward to the frontend
        const paramsToForward = new URLSearchParams();
        if (state) { // Always forward the state
            paramsToForward.append('state', state);
        }

        if (error) {
            logger.error({ error, error_description, state }, "Razorpay authorization failed.");
            paramsToForward.append('error', error);
            if (error_description) {
                paramsToForward.append('error_description', error_description);
            }
            paramsToForward.append('status', 'error');
        } else if (!code) { // `state` is confirmed to exist at this point
            logger.error({ query: request.query }, "Callback from Razorpay missing 'code' on what should be a success.");
            paramsToForward.append('error', 'missing_code');
            paramsToForward.append('error_description', 'Required code parameter missing in Razorpay callback.');
            paramsToForward.append('status', 'error');
        } else {
            // Successful authorization from Razorpay (code and state are present)
            paramsToForward.append('code', code);
            paramsToForward.append('status', 'success'); // Indicate success to frontend
        }

        // Construct the final redirect URL based on flow type
        if (isWebFlow) {
            if (!determinedFrontendWebBaseUrl) { // Should not happen if isWebFlow is true due to above logic
                logger.error({ state }, "Logic error: Web flow indicated but no base URL determined.");
                return reply.code(500).send({ error: 'server_configuration_error', error_description: 'Could not determine web redirect URL.' });
            }
            const webAppUrl = new URL(WEB_APP_CALLBACK_PATH, determinedFrontendWebBaseUrl);
            webAppUrl.search = paramsToForward.toString();
            targetRedirectUrl = webAppUrl.toString();
        } else {
            // Mobile app flow
            targetRedirectUrl = `${APP_SCHEME}://${APP_DOMAIN_PATH}?${paramsToForward.toString()}`;
        }

        logger.info(`Redirecting to frontend: ${targetRedirectUrl}`);
        return reply.redirect(302, targetRedirectUrl);
    });
};