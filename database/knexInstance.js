// db.js
require('dotenv').config();

const knex = require('knex');
const config = require('../knexfile'); // Adjust the path to your knexfile

// --- Add these logs ---
const environment = process.env.NODE_ENV || 'development'; // Determine environment *here*
console.log(`[KnexInstance DEBUG] Using environment determined as: ${environment}`);
const environmentConfig = config[environment]; // Select config block
console.log(`[KnexInstance DEBUG] Config object for environment '${environment}':`, JSON.stringify(environmentConfig, null, 2));

if (!environmentConfig) {
    console.error(`[KnexInstance ERROR] No configuration block found for environment '${environment}' in knexfile exports!`);
} else if (!environmentConfig.client) {
    console.error(`[KnexInstance ERROR] Configuration block for '${environment}' is MISSING the 'client' property!`, environmentConfig);
}

const knexInstance = knex(environmentConfig);

module.exports = knexInstance;