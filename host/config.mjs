import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function int(name, fallback) {
  const value = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

const baseUrl = (env.BASE_URL || `http://localhost:${int('PORT', 8080)}`).replace(/\/+$/, '');

export const config = {
  port: int('PORT', 8080),
  baseUrl,
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  wasmPath: env.WASM_PATH || path.join(here, '..', 'build', 'rack.wasm'),
  publicDir: env.PUBLIC_DIR || path.join(here, '..', 'public'),
  migrationsDir: env.MIGRATIONS_DIR || path.join(here, '..', 'db', 'migrations'),
  syncIntervalMinutes: int('SYNC_INTERVAL_MINUTES', 15),
  maxBodyBytes: 256 * 1024,
  rateLimitRead: int('RATE_LIMIT_READ_PER_MINUTE', 600),
  rateLimitWrite: int('RATE_LIMIT_WRITE_PER_MINUTE', 60),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: env.DB_USER || 'rack',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'rack',
    connectionLimit: int('DB_POOL_SIZE', 10),
  },
  // Handed to the wasm module with every request
  app: {
    baseUrl,
    githubClientId: env.GITHUB_CLIENT_ID || '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
    githubApiToken: env.GITHUB_TOKEN || '',
    adminLogins: env.ADMIN_LOGINS || '',
    secureCookies: baseUrl.startsWith('https://'),
  },
};
