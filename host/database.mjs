import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPool(dbConfig) {
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  // Every timestamp in the schema is UTC
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00', SESSION group_concat_max_len = 65536");
  });
  return pool;
}

/** Wait until the database accepts connections (it may still be starting when the container comes up) */
export async function waitForDatabase(pool, log, attempts = 60) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      log.info(`waiting for the database (${error.code ?? error.message}), attempt ${attempt}/${attempts}`);
      await sleep(2000);
    }
  }
}

/**
 * Package names have to be lower kebab-case (isValidPackageName in src/util.spice). Packages created under the older,
 * looser rules keep working in the database but their pages 404, so list them for the operator to rename.
 */
export async function warnAboutLegacyPackageNames(pool, log) {
  const [rows] = await pool.query(
    "SELECT name FROM packages WHERE name NOT REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$' OR CHAR_LENGTH(name) < 2 LIMIT 50",
  );
  if (rows.length) log.warn(`packages with names that are not lower kebab-case (rename them as admin): ${rows.map((r) => r.name).join(', ')}`);
}

/** Apply all pending migrations from the given directory, exactly once, guarded by a lock for multiple instances */
export async function migrate(dbConfig, dir, log) {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('spice_rack_migrate', 60) AS acquired");
    if (lock.acquired !== 1) throw new Error('could not acquire the migration lock');
    await connection.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)',
    );
    const [applied] = await connection.query('SELECT name FROM schema_migrations');
    const done = new Set(applied.map((row) => row.name));
    const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      log.info(`applying migration ${file}`);
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP())', [file]);
    }
    await connection.query("SELECT RELEASE_LOCK('spice_rack_migrate')");
  } finally {
    await connection.end();
  }
}
