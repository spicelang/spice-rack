import { createApp } from './app.mjs';
import { config } from './config.mjs';

const log = {
  info: (message) => console.log(`${new Date().toISOString()} INFO  ${message}`),
  warn: (message) => console.warn(`${new Date().toISOString()} WARN  ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ERROR ${message}`),
};

async function main() {
  const app = await createApp({ config, log });

  const syncTimer = setInterval(() => app.runSyncTask(), config.syncIntervalMinutes * 60_000);
  const firstSync = setTimeout(() => app.runSyncTask(), 20_000);

  await new Promise((resolve) => app.server.listen(config.port, '0.0.0.0', resolve));
  log.info(`Spice Rack listening on :${config.port} (${config.baseUrl})`);
  if (!config.app.githubClientId) log.warn('GITHUB_CLIENT_ID is not set: signing in will not work');
  if (!config.app.adminLogins) log.warn('ADMIN_LOGINS is not set: nobody will be able to reach the admin area');

  const shutdown = async (signal) => {
    log.info(`${signal} received, shutting down`);
    clearInterval(syncTimer);
    clearTimeout(firstSync);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  log.error(`startup failed: ${error.stack ?? error}`);
  process.exit(1);
});
