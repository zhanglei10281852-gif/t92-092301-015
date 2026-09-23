const config = require('./config');
const { createDatabase } = require('./db');
const { createApp } = require('./app');

const db = createDatabase(config.dbPath);
const app = createApp({ db });
const server = app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
