require('dotenv').config(); // If using a .env file

// --- Add these logs ---
console.log(`[Knexfile DEBUG] Timestamp: ${new Date().toISOString()}`);
console.log(`[Knexfile DEBUG] Attempting to load config for NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[Knexfile DEBUG] DB_HOST from env: ${process.env.DB_HOST}`); // Check if a DB var is loaded
// --- End added logs ---

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      ssl: { rejectUnauthorized: false },
    },
    migrations: {
      directory: './database/migrations',
    },
    seeds: {
      directory: './database/seeds',
    }
  },
};