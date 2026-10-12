// Fills a development database with demo data, to look at the UI. Usage:
//   DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=rack DB_PASSWORD=rack DB_NAME=rack node dev/seed.mjs
// It creates a session for the admin "demo-admin" and prints the cookie to use in the browser.
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import { createPool, migrate, waitForDatabase } from '../database.mjs';

const log = { info: console.log, warn: console.warn, error: console.error };
const pool = createPool(config.db);
await waitForDatabase(pool, log);
await migrate(config.db, config.migrationsDir, log);

const users = [
  [9001, 'demo-admin', 'Demo Admin', 'admin'],
  [9002, 'mia', 'Mia Keller', 'maintainer'],
  [9003, 'tobi', 'Tobias Arnold', 'maintainer'],
  [9004, 'sunny', 'Sunny Rao', 'maintainer'],
];
const packages = [
  ['json-parser', 'mia', 'A fast, streaming JSON parser with zero allocations on the hot path', 'json,parser,serialization', 18400, 312, 'MIT'],
  ['http-client', 'mia', 'HTTP/1.1 and HTTP/2 client with connection pooling and TLS', 'http,client,network', 12900, 205, 'Apache-2.0'],
  ['cli-kit', 'tobi', 'Declarative command line parsing with subcommands, completions and help output', 'cli,terminal', 9800, 150, 'MIT'],
  ['web-router', 'tobi', 'Trie based HTTP router with middleware support', 'http,web,server', 7400, 98, 'MIT'],
  ['sqlite-orm', 'sunny', 'Typed query builder and migrations on top of SQLite', 'database,sqlite,orm', 5100, 87, 'BSD-3-Clause'],
  ['tls-lib', 'sunny', 'TLS 1.3 implementation in pure Spice', 'crypto,tls,network', 3900, 140, 'MIT'],
  ['regex-plus', 'mia', 'Backtracking-free regular expression engine', 'text,regex', 3200, 61, 'MIT'],
  ['yaml-lite', 'sunny', 'Small YAML reader and writer', 'yaml,parser,serialization', 2600, 33, 'MIT'],
  ['test-kit', 'tobi', 'Test runner with fixtures, mocks and snapshot testing', 'testing,dev', 2100, 45, 'MIT'],
  ['log-forge', 'mia', 'Structured logging with sinks for stdout, files and syslog', 'logging', 1800, 22, 'MIT'],
  ['matrix-math', 'sunny', 'Dense linear algebra with SIMD kernels', 'math,simd,science', 1200, 71, 'MIT'],
  ['ini-reader', 'tobi', 'INI file parser', 'config,parser', 400, 4, 'MIT'],
];
const deps = {
  'http-client': [['tls-lib', '^1.0.0']],
  'web-router': [['http-client', '^2.0.0'], ['json-parser', '^1.0.0']],
  'sqlite-orm': [['log-forge', '~0.4.0']],
  'cli-kit': [['log-forge', '*']],
  'json-parser': [['regex-plus', '>=0.9.0, <2.0.0']],
  'regex-plus': [['ghost-unicode-tables', '^1.0.0']],
};

const now = new Date();
const stamp = (daysAgo) => new Date(now - daysAgo * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
const dayOnly = (daysAgo) => stamp(daysAgo).slice(0, 10);

const conn = await pool.getConnection();
const userIds = {};
for (const [githubId, login, name, role] of users) {
  await conn.query(
    'INSERT INTO users (github_id, login, display_name, avatar_url, role, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, "active", ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)',
    [githubId, login, name, '', role, stamp(40 - (githubId % 10) * 3), stamp(1)],
  );
  const [[row]] = await conn.query('SELECT id FROM users WHERE login = ?', [login]);
  userIds[login] = row.id;
}

let index = 0;
for (const [name, owner, description, tags, downloads, stars, license] of packages) {
  index++;
  const [existing] = await conn.query('SELECT id FROM packages WHERE name = ?', [name]);
  if (existing.length) continue;
  const [result] = await conn.query(
    'INSERT INTO packages (name, description, repo_owner, repo_name, homepage, license, stars, owner_id, downloads_total, readme_html, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, "", ?, ?, ?, ?, ?, ?, ?, ?)',
    [name, description, owner, name, license, stars, userIds[owner], downloads,
      `<h1>${name}</h1><p>${description}.</p><h2>Installation</h2><pre><code>"${name}": "^1.0.0"</code></pre><h2>Usage</h2><p>Import the module and call it. See the <a href="https://example.org">documentation</a> for details.</p><ul><li>Fast</li><li>Small</li><li>Well tested</li></ul>`,
      stamp(0.1), stamp(60 - index * 4), stamp(index * 2)],
  );
  const id = result.insertId;
  for (const tag of tags.split(',')) await conn.query('INSERT INTO package_tags (package_id, tag) VALUES (?, ?)', [id, tag]);

  let latestId = null;
  const versions = ['0.9.0', '1.0.0', '1.1.0', '1.2.0'];
  for (const [i, version] of versions.entries()) {
    const [v] = await conn.query(
      'INSERT INTO package_versions (package_id, version, tag_name, title, changelog, changelog_html, prerelease, tarball_url, published_at, downloads) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [id, version, `v${version}`, `Version ${version}`, `- Improvements in ${version}`, `<ul><li>Improvements in ${version}</li><li>Fixed a bug in the parser</li></ul>`,
        `https://github.com/${owner}/${name}/archive/refs/tags/v${version}.tar.gz`, stamp(90 - i * 25 - index), Math.round(downloads * (i + 1) / 10)],
    );
    latestId = v.insertId;
    if (i === versions.length - 1) {
      for (const [dep, constraint] of deps[name] ?? []) {
        await conn.query('INSERT INTO package_dependencies (version_id, dep_name, constraint_text, dev) VALUES (?, ?, ?, 0)', [latestId, dep, constraint]);
      }
    }
  }
  await conn.query('UPDATE packages SET latest_version_id = ? WHERE id = ?', [latestId, id]);

  for (let d = 0; d < 30; d++) {
    const wave = 1 + Math.sin((d + index) / 3) * 0.5;
    await conn.query('INSERT INTO package_stats_daily (package_id, day, downloads, views) VALUES (?, ?, ?, ?)', [
      id, dayOnly(d), Math.round((downloads / 600) * wave * (1 + (30 - d) / 60)), Math.round((downloads / 200) * wave),
    ]);
  }
}

const sessionId = crypto.randomBytes(32).toString('hex');
await conn.query(
  'INSERT INTO sessions (id, user_id, csrf, github_token, created_at, expires_at) VALUES (?, ?, ?, "", ?, DATE_ADD(?, INTERVAL 7 DAY))',
  [sessionId, userIds['demo-admin'], crypto.randomBytes(16).toString('hex'), stamp(0), stamp(0)],
);
conn.release();
console.log(`\nSeeded. Browser cookie for the admin session:\n  document.cookie = "rack_session=${sessionId}; path=/"`);
await pool.end();
