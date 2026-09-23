const path = require('node:path');
require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 6847),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'elderly-meal.sqlite3'),
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  monthlySubsidyQuota: Number(process.env.MONTHLY_SUBSIDY_QUOTA || 100000),
};
