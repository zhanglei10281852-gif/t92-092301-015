const config = require('./config');
const { createDatabase } = require('./db');

const db = createDatabase(config.dbPath);
db.close();
console.log(`SQLite database ready: ${config.dbPath}`);
