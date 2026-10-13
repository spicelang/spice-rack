import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

import { createPool, migrate, waitForDatabase } from './database.mjs';
import { createEffects } from './effects.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { loadRuntime } from './runtime.mjs';
import { loadTemplates } from './templates.mjs';

const MAX_STEPS = 16;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Static assets are small, so they are read once at startup */
async function loadStatic(dir) {
  const files = new Map();
  for (const name of await fs.readdir(dir)) {
    const type = MIME[path.extname(name)];
    if (!type) continue;
    const data = await fs.readFile(path.join(dir, name));
    const etag = `"${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
    const compressible = type.startsWith('text/') || type.startsWith('image/svg');
    files.set(`/static/${name}`, { data, type, etag, gzip: compressible ? zlib.gzipSync(data) : null });
  }
  return files;
}

const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const acceptsGzip = (req) => /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));

/**
 * Builds the application: loads the wasm module, connects to MySQL, applies migrations and returns an HTTP server
 * (not yet listening) plus the hooks to run the background task and to shut down.
 *
 * @param {object} options
 * @param {object} options.config  see config.mjs
 * @param {object} options.log     logger with info/warn/error
 * @param {typeof fetch} [options.fetchImpl]  replaceable for tests
 */
export async function createApp({ config, log, fetchImpl = fetch }) {
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // The only scripts are /static/theme.js (light/dark switch) and /static/local-time.js (times in the visitor's timezone). README HTML comes from GitHub, but is never allowed to run code here either.
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (config.app.secureCookies) securityHeaders['Strict-Transport-Security'] = 'max-age=31536000';

  const staticFiles = await loadStatic(config.publicDir);
  const runtime = await loadRuntime(config.wasmPath, await loadTemplates(config.templatesDir));
  const templateErrors = runtime.templateErrors();
  if (templateErrors) throw new Error(`broken templates:\n${templateErrors}`);
  const pool = createPool(config.db);
  await waitForDatabase(pool, log);
  await migrate(config.db, config.migrationsDir, log);
  const executeBatch = createEffects(pool, log, fetchImpl);
  const limiter = createRateLimiter();

  function clientIp(req) {
    if (config.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      // The last entry is the one the (single) trusted proxy added; earlier ones can be forged by the client
      if (typeof forwarded === 'string' && forwarded) return forwarded.split(',').pop().trim();
    }
    return req.socket.remoteAddress ?? '';
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > config.maxBodyBytes) throw Object.assign(new Error('body too large'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  function send(req, res, status, headers, body) {
    const out = { ...securityHeaders, ...headers };
    let payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
    const type = String(out['Content-Type'] ?? '');
    const compressible = /^(text\/|application\/(json|xml)|image\/svg)/.test(type);
    if (acceptsGzip(req) && compressible && payload.length > 1024 && !out['Content-Encoding']) {
      payload = zlib.gzipSync(payload);
      out['Content-Encoding'] = 'gzip';
      out.Vary = 'Accept-Encoding';
    }
    out['Content-Length'] = payload.length;
    res.writeHead(status, out);
    res.end(req.method === 'HEAD' || status === 304 ? undefined : payload);
  }

  /** Drive the wasm module until it produces a response */
  async function runRequest(envelope) {
    for (let step = 0; step < MAX_STEPS; step++) {
      const action = runtime.step(envelope);
      if (action.response) return action.response;
      if (!action.batch) throw new Error('wasm module returned neither a response nor a batch');
      envelope.results.push(await executeBatch(action.batch));
    }
    throw new Error('too many steps for one request');
  }

  const newEnvelope = (request) => ({
    req: request,
    now: nowUtc(),
    random: crypto.randomBytes(64).toString('hex'),
    config: config.app,
    results: [],
  });

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    if (url.pathname === '/healthz') {
      try {
        await pool.query('SELECT 1');
        return send(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, '{"status":"ok"}');
      } catch {
        return send(req, res, 503, { 'Content-Type': 'application/json' }, '{"status":"database unavailable"}');
      }
    }

    if (url.pathname.startsWith('/static/')) {
      const file = staticFiles.get(url.pathname);
      if (!file || method !== 'GET') return send(req, res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
      const headers = { 'Content-Type': file.type, ETag: file.etag, 'Cache-Control': 'public, max-age=3600' };
      if (req.headers['if-none-match'] === file.etag) return send(req, res, 304, headers, '');
      const gzip = file.gzip && acceptsGzip(req);
      if (gzip) {
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
      }
      return send(req, res, 200, headers, gzip ? file.gzip : file.data);
    }

    if (method !== 'GET' && method !== 'POST') {
      return send(req, res, 405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD, POST' }, 'Method not allowed');
    }

    const ip = clientIp(req);
    const bucket = method === 'POST' || url.pathname.startsWith('/auth') || url.pathname.endsWith('/download') ? 'write' : 'read';
    if (!limiter.allow(`${bucket}:${ip}`, bucket === 'write' ? config.rateLimitWrite : config.rateLimitRead)) {
      return send(req, res, 429, { 'Content-Type': 'text/plain', 'Retry-After': '60' }, 'Too many requests. Please slow down.');
    }

    const body = method === 'POST' ? await readBody(req) : '';
    const response = await runRequest(
      newEnvelope({
        method,
        path: url.pathname,
        query: url.search.startsWith('?') ? url.search.slice(1) : '',
        cookie: String(req.headers.cookie ?? ''),
        ip,
        userAgent: String(req.headers['user-agent'] ?? ''),
        contentType: String(req.headers['content-type'] ?? ''),
        body,
      }),
    );

    const headers = { ...response.headers };
    if (response.cookies?.length) headers['Set-Cookie'] = response.cookies;
    send(req, res, response.status, headers, response.body);
    const elapsed = Number((process.hrtime.bigint() - started) / 1_000_000n);
    log.info(`${method} ${url.pathname} ${response.status} ${elapsed}ms wasm=${(runtime.lastUsage / 1024) | 0}KiB`);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log.error(`${req.method} ${req.url}: ${error.stack ?? error}`);
      if (res.headersSent) return res.destroy();
      const status = error.status ?? 500;
      send(req, res, status, { 'Content-Type': 'text/plain; charset=utf-8' }, status === 413 ? 'Request too large' : 'Internal server error');
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 65_000;

  /** Background sync of package metadata, driven by the wasm module through a synthetic request */
  let syncing = false;
  async function runSyncTask() {
    if (syncing) return null;
    syncing = true;
    try {
      const response = await runRequest(
        newEnvelope({ method: 'TASK', path: '/tasks/sync', query: '', cookie: '', ip: '', userAgent: 'task', contentType: '', body: '' }),
      );
      const summary = String(response.body).trim();
      if (summary !== 'nothing to sync') log.info(`sync task: ${summary}`);
      return summary;
    } catch (error) {
      log.error(`sync task failed: ${error.stack ?? error}`);
      return null;
    } finally {
      syncing = false;
    }
  }

  return {
    server,
    runSyncTask,
    async close() {
      server.close();
      server.closeIdleConnections?.();
      await pool.end().catch(() => {});
    },
  };
}
