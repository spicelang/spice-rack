const ALLOWED_HTTP_HOSTS = new Set(['api.github.com', 'github.com', 'raw.githubusercontent.com']);
const HTTP_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The message of a GitHub error response, or the start of any other body */
function errorMessage(body) {
  try {
    const message = JSON.parse(body)?.message;
    if (typeof message === 'string') return message.slice(0, 200);
  } catch {
    // not JSON
  }
  return body.slice(0, 200).replace(/\s+/g, ' ');
}

/**
 * Executes the effects the wasm module asks for: SQL statements and outgoing HTTP requests.
 */
export function createEffects(pool, log, fetchImpl = fetch) {
  async function runSql(connection, effect) {
    const [result] = await connection.query({ sql: effect.sql, values: effect.params ?? [] });
    if (Array.isArray(result)) return { rows: result };
    return { affected: result.affectedRows ?? 0, insertId: result.insertId ?? 0 };
  }

  async function runHttp(effect) {
    let url;
    try {
      url = new URL(effect.url);
    } catch {
      return { status: 0, error: 'invalid url' };
    }
    if (url.protocol !== 'https:' || !ALLOWED_HTTP_HOSTS.has(url.hostname)) {
      return { status: 0, error: `host not allowed: ${url.hostname}` };
    }
    const headers = { 'User-Agent': 'spice-rack (https://rack.spicelang.com)', ...(effect.headers ?? {}) };
    if (url.hostname === 'api.github.com') headers['X-GitHub-Api-Version'] = '2022-11-28';
    try {
      const response = await fetchImpl(url, {
        method: effect.method || 'GET',
        headers,
        body: effect.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_RESPONSE_BYTES) return { status: 0, error: 'response too large' };
      const body = buffer.toString('utf8');
      // A missing readme or manifest is routine, every other error status is worth a line
      if (response.status >= 400 && response.status !== 404) {
        log.warn(`http ${effect.method} ${url.hostname}${url.pathname} returned ${response.status}: ${errorMessage(body)}`);
      }
      return { status: response.status, body };
    } catch (error) {
      log.warn(`http ${effect.method} ${url.hostname}${url.pathname} failed: ${error.message}`);
      return { status: 0, error: error.message };
    }
  }

  /**
   * Run a batch and return one result per effect. SQL statements run in order on one connection (inside a
   * transaction if requested) and stop at the first error. A batch of HTTP calls only runs them concurrently.
   */
  return async function executeBatch(batch) {
    const effects = batch.effects ?? [];
    if (effects.every((effect) => effect.type === 'http')) {
      return Promise.all(effects.map(runHttp));
    }

    const results = [];
    const connection = await pool.getConnection();
    let failed = false;
    try {
      if (batch.tx) await connection.beginTransaction();
      for (const effect of effects) {
        if (failed) {
          results.push({ error: 'skipped after earlier error' });
          continue;
        }
        try {
          results.push(effect.type === 'sql' ? await runSql(connection, effect) : await runHttp(effect));
        } catch (error) {
          failed = true;
          log.warn(`sql failed: ${error.code ?? ''} ${error.message}`);
          results.push({ error: error.message, code: error.code ?? '' });
        }
      }
      if (batch.tx) {
        if (failed) await connection.rollback();
        else await connection.commit();
      }
    } finally {
      connection.release();
    }
    return results;
  };
}
