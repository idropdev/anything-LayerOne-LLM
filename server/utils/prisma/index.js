const { PrismaClient } = require("@prisma/client");

// npx prisma introspect
// npx prisma generate
// npx prisma migrate dev --name init -> ensures that db is in sync with schema
// npx prisma migrate reset -> resets the db

const logLevels = ["error", "info", "warn"]; // add "query" to debug query logs
const prisma = new PrismaClient({
  log: logLevels,
});

// Enable WAL mode and set busy_timeout for SQLite to improve concurrent access
// WAL mode is persistent and set on the database file (enabled via migration/setup)
// busy_timeout must be set per-connection (done here on first connection)
// This is critical for handling concurrent requests from Keystone
let sqliteConfigured = false;
let sqliteConfiguring = false;
const configureSQLite = async () => {
  if (sqliteConfigured || sqliteConfiguring) return;
  sqliteConfiguring = true;
  try {
    // Ensure connection is established
    await prisma.$connect();
    // Set busy_timeout (connection-level setting, must be set per-connection)
    // This PRAGMA returns the new timeout value, so we use $queryRaw
    await prisma.$queryRaw`PRAGMA busy_timeout = 30000`; // 30 second timeout
    sqliteConfigured = true;
  } catch (err) {
    // Silently ignore - PRAGMA may fail if not SQLite
    // This is non-fatal and won't prevent the application from working
  } finally {
    sqliteConfiguring = false;
  }
};

// Configure SQLite immediately on module load
// This ensures busy_timeout is set when the connection is first established
// Note: WAL mode should already be enabled on the database file
configureSQLite().catch(() => {
  // Ignore errors - connection will still work, just without the timeout optimization
});

module.exports = prisma;
