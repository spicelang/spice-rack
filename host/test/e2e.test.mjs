// End-to-end test: real wasm module, real MySQL, mocked GitHub.
//   E2E_DB_HOST/PORT/USER/PASSWORD/NAME point at a throw-away database (its name must end in "_test"). Without
//   E2E_DB_NAME the test is skipped.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

import { createApp } from '../app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbName = process.env.E2E_DB_NAME;
const skip = !dbName || !dbName.endsWith('_test') ? 'set E2E_DB_NAME=<something>_test to run' : false;

const db = {
  host: process.env.E2E_DB_HOST || '127.0.0.1',
  port: Number(process.env.E2E_DB_PORT || 3306),
  user: process.env.E2E_DB_USER || 'rack',
  password: process.env.E2E_DB_PASSWORD || 'rack',
  database: dbName,
  connectionLimit: 4,
};

// ---------------------------------------------------------------------------------------------------------------------
// GitHub fixtures
// ---------------------------------------------------------------------------------------------------------------------

const USERS = {
  'tok-admin': { id: 1001, login: 'testadmin', name: 'Test Admin', avatar_url: 'https://avatars.example/a.png' },
  'tok-bob': { id: 1002, login: 'bob', name: 'Bob', avatar_url: 'https://avatars.example/b.png' },
};
const repoInfo = (name, extra = {}) => ({
  name,
  owner: { login: 'testadmin' },
  description: `The ${name} library`,
  stargazers_count: 42,
  license: { spdx_id: 'MIT' },
  homepage: 'https://example.org/' + name,
  permissions: { push: true, admin: true },
  ...extra,
});
const release = (tag, extra = {}) => ({
  tag_name: tag,
  name: `Release ${tag}`,
  body: `- changed things in ${tag}`,
  body_html: `<ul><li>changed things in ${tag}</li></ul>`,
  draft: false,
  prerelease: false,
  published_at: '2026-09-15T10:00:00Z',
  ...extra,
});
const FIXTURES = {
  'POST https://github.com/login/oauth/access_token': (opts) => json({ access_token: `tok-${JSON.parse(opts.body).code}` }),
  'GET https://github.com/testadmin.png?size=64': () => new Response(Buffer.from('PNGDATA'), { status: 200, headers: { 'Content-Type': 'image/png' } }),
  'GET https://api.github.com/user': (opts) => json(USERS[opts.headers.Authorization.replace('Bearer ', '')]),
  'GET https://api.github.com/users/testadmin/repos?per_page=100&sort=pushed&type=owner': () =>
    json([
      { full_name: 'testadmin/json-parser', fork: false, archived: false },
      { full_name: 'testadmin/http-client', fork: false, archived: false },
      { full_name: 'testadmin/forked', fork: true, archived: false },
    ]),
  'GET https://api.github.com/repos/testadmin/json-parser': () => json(repoInfo('json-parser')),
  'GET https://api.github.com/repos/testadmin/http-client': () => json(repoInfo('http-client')),
  'GET https://api.github.com/repos/testadmin/nopush': () => json(repoInfo('nopush', { permissions: { push: false } })),
  'GET https://api.github.com/repos/testadmin/json-parser/readme': () =>
    html('<h1>json-parser</h1><p>A <b>fast</b> parser. <a href="docs/usage.md">usage</a></p><img src="img/logo.png">'),
  'GET https://api.github.com/repos/testadmin/http-client/readme': () => html('<h1>http-client</h1>'),
  'GET https://api.github.com/repos/testadmin/big': () => json(repoInfo('big')),
  'GET https://api.github.com/repos/testadmin/big/readme': () => html('<p>line <a href="x.md">y</a> &amp; <img src="a.png"></p>\n'.repeat(20000)),
  'GET https://api.github.com/repos/testadmin/big/releases?per_page=30': () => json([release('v0.1.0')]),
  'GET https://api.github.com/repos/testadmin/json-parser/releases?per_page=30': () =>
    json([release('v1.2.0'), release('v1.1.0', { published_at: '2026-08-01T10:00:00Z' }), release('v2.0.0-rc.1', { prerelease: true }), release('nightly')]),
  'GET https://api.github.com/repos/testadmin/http-client/releases?per_page=30': () => json([release('v1.0.0')]),
  'GET https://raw.githubusercontent.com/testadmin/json-parser/v1.2.0/spice.toml': () =>
    toml(`# json-parser
[package]
name = "json-parser"
version = "1.2.0"
spice = ">=0.29.0"

[dependencies]
http-client = "^1.0.0" # short form
ghost = { version = ">=1.0.0" }
http-utils = { github = "owner/Http-Utils", rev = "v1.0.0" }

[ dev-dependencies ]
test-kit = "*"

[tool.some-linter]
max-line = 120
ratio = -1.5e3
`),
  'GET https://raw.githubusercontent.com/testadmin/http-client/v1.0.0/spice.toml': () =>
    toml('[package]\nname = "http-client"\nversion = "1.0.0"\n\n[dependencies]\ntls-lib = "^2.0.0"\njson-parser = "*"\n'),
  'GET https://raw.githubusercontent.com/testadmin/json-parser/v1.1.0/spice.toml': () =>
    toml('[package]\nname = "json-parser"\nversion = "1.1.0"\n'),
  'GET https://raw.githubusercontent.com/testadmin/json-parser/v2.0.0-rc.1/spice.toml': () => new Response('nope', { status: 404 }),
  // A repository with several packages in subdirectories
  'GET https://api.github.com/repos/testadmin/packages': () => json(repoInfo('packages')),
  'GET https://api.github.com/repos/testadmin/packages/contents/packages/github/spice.toml': () => json({ type: 'file' }),
  'GET https://api.github.com/repos/testadmin/packages/contents/packages/yaml/spice.toml': () => json({ type: 'file' }),
  'GET https://api.github.com/repos/testadmin/packages/readme/packages/github': () =>
    html('<h1>github</h1><a href="docs/usage.md">usage</a><img src="/media/logo.png">'),
  'GET https://api.github.com/repos/testadmin/packages/releases?per_page=100': () =>
    json([
      release('yaml-v2.0.0'),
      release('github-v0.2.0'),
      release('v9.0.0'),
      release('github/v0.1.0', { published_at: '2026-08-01T10:00:00Z' }),
    ]),
  'GET https://raw.githubusercontent.com/testadmin/packages/github-v0.2.0/packages/github/spice.toml': () =>
    toml('[package]\nname = "github"\nversion = "0.2.0"\ndescription = "Client for the GitHub REST API"\n\n[dependencies]\njson-parser = "^1.2.0"\n'),
  'GET https://raw.githubusercontent.com/testadmin/packages/github%2Fv0.1.0/packages/github/spice.toml': () =>
    toml('[package]\nname = "github"\nversion = "0.1.0"\n'),
};
function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function toml(value) {
  return new Response(value, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
function html(value) {
  return new Response(value, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
const requestsSeen = [];
const excerpt = (text, re) => {
  const body = String(text);
  const main = body.indexOf('<main');
  return `${re} not as expected in: ${body.slice(main > 0 ? main : 0, (main > 0 ? main : 0) + 600)}`;
};
const has = (text, re) => assert.ok(re.test(String(text)), excerpt(text, re));
const lacks = (text, re) => assert.ok(!re.test(String(text)), excerpt(text, re));
async function mockFetch(url, opts = {}) {
  const key = `${opts.method || 'GET'} ${url}`;
  requestsSeen.push(key);
  const handler = FIXTURES[key];
  if (!handler) return new Response('not found', { status: 404 });
  return handler(opts);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tiny HTTP client with a cookie jar
// ---------------------------------------------------------------------------------------------------------------------

function client(baseUrl) {
  const jar = new Map();
  async function request(method, pathname, form) {
    const headers = { 'User-Agent': 'e2e-test/1.0' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(baseUrl + pathname, { method, headers, body, redirect: 'manual' });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    assert.ok(!text.includes('<!-- template error'), `template error in ${method} ${pathname}: ${text.slice(text.indexOf('<!-- template error'))}`);
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text };
  }
  return {
    get: (p) => request('GET', p),
    post: (p, form) => request('POST', p, form),
    jar,
    csrf: (text) => /name="csrf" value="([0-9a-f]+)"/.exec(text)?.[1],
  };
}

// ---------------------------------------------------------------------------------------------------------------------

describe('Spice Rack', { skip }, () => {
  let app;
  let baseUrl;
  let admin;
  let bob;
  let anon;
  let conn;

  before(async () => {
    conn = await mysql.createConnection({ ...db, multipleStatements: true });
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query('SHOW TABLES');
    for (const row of tables) await conn.query(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const config = {
      port: 0,
      baseUrl: 'http://localhost:0',
      trustProxy: false,
      wasmPath: path.join(here, '..', '..', 'build', 'rack.wasm'),
      publicDir: path.join(here, '..', '..', 'public'),
      templatesDir: path.join(here, '..', '..', 'templates'),
      migrationsDir: path.join(here, '..', '..', 'db', 'migrations'),
      syncIntervalMinutes: 15,
      maxBodyBytes: 256 * 1024,
      rateLimitRead: 100000,
      rateLimitWrite: 100000,
      db,
      app: { baseUrl: 'http://localhost:0', githubClientId: 'cid', githubClientSecret: 'secret', githubApiToken: '', adminLogins: 'TestAdmin', secureCookies: false },
    };
    const quiet = { info() {}, warn() {}, error: (m) => console.error(m) };
    app = await createApp({ config, log: quiet, fetchImpl: mockFetch });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    config.app.baseUrl = baseUrl;
    admin = client(baseUrl);
    bob = client(baseUrl);
    anon = client(baseUrl);
  });

  after(async () => {
    await app?.close();
    await conn?.end();
  });

  async function login(who, code) {
    const start = await who.get('/auth/github');
    assert.equal(start.status, 303);
    const state = new URL(start.location).searchParams.get('state');
    has(start.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=cid/);
    const done = await who.get(`/auth/github/callback?code=${code}&state=${state}`);
    assert.equal(done.status, 303, done.text);
    return done;
  }

  it('serves the home page and static assets', async () => {
    const home = await anon.get('/');
    assert.equal(home.status, 200);
    has(home.text, /Find and share/);
    has(home.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
    has(home.text, /<script src="\/static\/local-time.js" defer><\/script>/);
    has(home.text, /<script src="\/static\/theme.js"><\/script>/);
    has(home.text, /id="theme-toggle"/);
    has(home.text, /<script src="\/static\/dismiss.js" defer><\/script>/);
    has(home.text, /<section class="cta">/);
    const created = await anon.get('/?notice=created');
    assert.equal(created.status, 200);
    has(created.text, /class="notice notice-ok"[^]*data-dismiss="notice"/);
    const denied = await anon.get('/?error=denied');
    has(denied.text, /notice-err/);
    lacks(denied.text, /data-dismiss="notice"/);
    const theme = await anon.get('/static/theme.js');
    assert.equal(theme.status, 200);
    has(theme.headers.get('content-type'), /text\/javascript/);
    const script = await anon.get('/static/local-time.js');
    assert.equal(script.status, 200);
    has(script.headers.get('content-type'), /text\/javascript/);
    const css = await anon.get('/static/style.css');
    assert.equal(css.status, 200);
    has(css.text, /--accent/);
    assert.equal((await anon.get('/healthz')).status, 200);
    assert.equal((await anon.get('/nope')).status, 404);
  });

  it('serves avatars from our own origin with a long cache lifetime', async () => {
    const before = requestsSeen.length;
    const first = await anon.get('/avatar/testadmin');
    assert.equal(first.status, 200);
    has(first.headers.get('content-type'), /^image\/png/);
    has(first.headers.get('cache-control'), /max-age=86400/);
    assert.equal(first.text, 'PNGDATA');
    await anon.get('/avatar/TestAdmin');
    assert.equal(requestsSeen.slice(before).filter((k) => k.includes('testadmin.png')).length, 1, 'second request is served from the cache');
    assert.equal((await anon.get('/avatar/nobody')).status, 404);
    assert.equal((await anon.get('/avatar/..%2Fetc')).status, 404);
    assert.equal((await anon.get('/avatar/-bad')).status, 404);
  });

  it('rejects bad OAuth callbacks', async () => {
    const bad = await anon.get('/auth/github/callback?code=x&state=' + 'a'.repeat(32));
    assert.equal(bad.location, '/?error=state');
    const denied = await anon.get('/auth/github/callback?error=access_denied');
    assert.equal(denied.location, '/?error=denied');
  });

  it('signs in with GitHub and sets a session cookie', async () => {
    const done = await login(admin, 'admin');
    assert.equal(done.location, '/dashboard');
    assert.ok(admin.jar.get('rack_session')?.length === 64);
    const dash = await admin.get('/dashboard');
    assert.equal(dash.status, 200);
    has(dash.text, /Signed in as <strong>testadmin<\/strong> &middot; admin/);
    has(dash.text, /first package/);
  });

  it('requires sign-in for protected pages', async () => {
    assert.equal((await anon.get('/dashboard')).location, '/auth/github');
    assert.equal((await anon.get('/admin')).location, '/auth/github');
  });

  it('creates packages from GitHub repositories and syncs them', async () => {
    const form = await admin.get('/dashboard/packages/new');
    assert.equal(form.status, 200);
    has(form.text, /testadmin\/json-parser/);
    lacks(form.text, /testadmin\/forked/);
    const csrf = admin.csrf(form.text);
    assert.ok(csrf);

    // CSRF protection
    assert.equal((await admin.post('/dashboard/packages/new', { repo: 'testadmin/json-parser' })).status, 403);

    // validation
    const bad = await admin.post('/dashboard/packages/new', { csrf, repo: 'nonsense', name: '' });
    assert.equal(bad.status, 400);
    has(bad.text, /choose a repository/);
    const noPush = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/nopush' });
    assert.equal(noPush.status, 409);
    has(noPush.text, /push access/);

    const created = await admin.post('/dashboard/packages/new', {
      csrf,
      repo: 'testadmin/json-parser',
      name: 'json-parser',
      description: '',
      tags: 'JSON, Parser, web server, json',
      homepage: '',
    });
    assert.equal(created.status, 303, created.text);
    assert.equal(created.location, '/packages/json-parser?notice=created');

    const second = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/http-client', tags: 'http,client' });
    assert.equal(second.location, '/packages/http-client?notice=created');

    const dup = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/json-parser', name: 'json-parser' });
    assert.equal(dup.status, 409);
    has(dup.text, /already exists/);
  });

  it('only accepts lower kebab-case package names', async () => {
    const csrf = admin.csrf((await admin.get('/dashboard/packages/new')).text);
    has((await admin.get('/dashboard/packages/new')).text, /lower kebab-case/);
    for (const name of ['Json_Parser', 'json.parser', 'json_parser', '-json', 'json-', 'json--parser', 'a']) {
      const res = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/json-parser', name });
      assert.equal(res.status, 400, `${name} should be rejected`);
      has(res.text, /lower kebab-case/);
    }
    // Invalid names do not exist as routes or API resources either
    assert.equal((await anon.get('/packages/json_parser')).status, 404);
    assert.equal((await anon.get('/api/v1/packages/json_parser')).status, 404);
  });

  it('copes with very large READMEs', async () => {
    const csrf = admin.csrf((await admin.get('/dashboard/packages/new')).text);
    const created = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/big', name: 'big-readme' });
    assert.equal(created.location, '/packages/big-readme?notice=created');
    const page = await anon.get('/packages/big-readme');
    assert.equal(page.status, 200);
    assert.ok(page.text.length > 1_000_000, `readme length ${page.text.length}`);
    has(page.text, /raw.githubusercontent.com\/testadmin\/big\/HEAD\/a.png/);
    await admin.post('/dashboard/packages/big-readme', { csrf, action: 'delete', confirm: 'big-readme' });
  });

  it('creates several packages from the directories of one repository', async () => {
    const csrf = admin.csrf((await admin.get('/dashboard/packages/new')).text);
    const missing = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/packages', path: 'packages/nope' });
    assert.equal(missing.status, 409);
    has(missing.text, /The directory packages\/nope of this repository has no spice.toml/);
    const badPath = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/packages', path: '../etc' });
    assert.equal(badPath.status, 400);
    has(badPath.text, /The directory must be a path/);

    // The link of the directory on GitHub works as well; the name defaults to the directory
    const github = await admin.post('/dashboard/packages/new', { csrf, repo: 'https://github.com/testadmin/packages/tree/main/packages/github' });
    assert.equal(github.location, '/packages/github?notice=created', github.text);
    const yaml = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/packages', path: '/packages/yaml/' });
    assert.equal(yaml.location, '/packages/yaml?notice=created', yaml.text);
    const dup = await admin.post('/dashboard/packages/new', { csrf, repo: 'testadmin/packages', path: 'packages/yaml', name: 'yaml-two' });
    assert.equal(dup.status, 409);
    has(dup.text, /already exists/);

    // Each package only has the releases tagged with its directory, and its description comes from its manifest
    const pkg = JSON.parse((await anon.get('/api/v1/packages/github')).text);
    assert.equal(pkg.package.path, 'packages/github');
    assert.equal(pkg.package.repository, 'https://github.com/testadmin/packages');
    assert.equal(pkg.package.description, 'Client for the GitHub REST API');
    assert.equal(pkg.package.homepage, '');
    assert.equal(pkg.package.latestVersion, '0.2.0');
    assert.deepEqual(pkg.versions.map((v) => v.tag), ['github-v0.2.0', 'github/v0.1.0']);
    assert.deepEqual(pkg.versions[0].dependencies, { 'json-parser': '^1.2.0' });
    const other = JSON.parse((await anon.get('/api/v1/packages/yaml')).text);
    assert.deepEqual(other.versions.map((v) => v.version), ['2.0.0']);
    assert.equal(other.package.description, '');
    const dl = await anon.get('/api/v1/packages/github/versions/0.1.0/download');
    assert.equal(dl.location, 'https://github.com/testadmin/packages/archive/refs/tags/github%2Fv0.1.0.tar.gz');

    // README links resolve against the directory, the repository link points to it
    const page = await anon.get('/packages/github');
    has(page.text, /href="https:\/\/github.com\/testadmin\/packages\/blob\/HEAD\/packages\/github\/docs\/usage.md"/);
    has(page.text, /src="https:\/\/raw.githubusercontent.com\/testadmin\/packages\/HEAD\/media\/logo.png"/);
    has(page.text, /href="https:\/\/github.com\/testadmin\/packages\/tree\/HEAD\/packages\/github"/);
    has((await anon.get('/packages/yaml')).text, /href="https:\/\/github.com\/testadmin\/packages\/tree\/HEAD\/packages\/yaml"/);
    has((await admin.get('/dashboard/packages/github')).text, /repository testadmin\/packages, directory packages\/github/);
    has((await admin.get('/admin/packages?q=packages%2Fyaml')).text, /testadmin\/packages\/packages\/yaml/);

    // A sync keeps it that way
    await admin.post('/dashboard/packages/github', { csrf, action: 'sync' });
    const synced = JSON.parse((await anon.get('/api/v1/packages/github')).text);
    assert.equal(synced.versions.length, 2);

    for (const name of ['github', 'yaml']) await admin.post(`/dashboard/packages/${name}`, { csrf, action: 'delete', confirm: name });
  });

  it('shows the package page with README, versions, dependencies and stats', async () => {
    const page = await anon.get('/packages/json-parser?notice=created');
    assert.equal(page.status, 200);
    has(page.text, /<h1>json-parser<\/h1>/);
    has(page.text, /v1\.2\.0/);
    has(page.text, /The json-parser library/);
    has(page.text, /A <b>fast<\/b> parser/);
    has(page.text, /href="https:\/\/github.com\/testadmin\/json-parser\/blob\/HEAD\/docs\/usage.md"/);
    has(page.text, /src="https:\/\/raw.githubusercontent.com\/testadmin\/json-parser\/HEAD\/img\/logo.png"/);
    has(page.text, /href="\/packages\?tag=parser"/);
    has(page.text, /MIT/);
    has(page.text, /Package created/);
    has(page.text, /json-parser = "\^1\.2\.0"/);

    const versions = await anon.get('/packages/json-parser?tab=versions');
    has(versions.text, /<h3>v1\.2\.0<\/h3>/);
    has(versions.text, /<h3>v1\.1\.0<\/h3>/);
    has(versions.text, /changed things in v1\.2\.0/);
    has(versions.text, /pre-release/);
    has(versions.text, /15 Sep 2026/);
    lacks(versions.text, /nightly/);

    const deps = await anon.get('/packages/json-parser?tab=dependencies');
    has(deps.text, /<details open>/);
    has(deps.text, /href="\/packages\/http-client"/);
    has(deps.text, /\^1\.0\.0/);
    has(deps.text, /ghost/);
    has(deps.text, /not found/);
    has(deps.text, /Development dependencies/);
    has(deps.text, /test-kit/);
    lacks(deps.text, /http-utils/);
    // nested level, with the cycle back to json-parser cut off
    has(deps.text, /<details open><summary>[^]*http-client[^]*<\/summary><ul class="dep-tree">[^]*tls-lib/);
    const tree = deps.text.split('<h2>Dependency tree</h2>')[1].split('<h3>Development')[0];
    lacks(tree, /href="\/packages\/json-parser"/);
    has(tree, /href="\/packages\/http-client"/);
    const depsOfHttp = await anon.get('/packages/http-client?tab=dependencies');
    has(depsOfHttp.text, /Used by/);
    has(depsOfHttp.text, /href="\/packages\/json-parser"/);

    const stats = await anon.get('/packages/json-parser?tab=stats');
    assert.equal(stats.status, 200);
    has(stats.text, /<svg viewBox/);
    has(stats.text, /Downloads by version/);
    assert.equal((await anon.get('/packages/does-not-exist')).status, 404);
    assert.equal((await anon.get('/packages/Not_Valid!')).status, 404);
  });

  it('searches, filters and sorts', async () => {
    const all = await anon.get('/packages');
    has(all.text, /2 packages found/);
    const q = await anon.get('/packages?q=json');
    has(q.text, /1 package found/);
    has(q.text, /json-parser/);
    lacks(q.text, /<a href="\/packages\/http-client">/);
    const tag = await anon.get('/packages?tag=client');
    has(tag.text, /http-client/);
    lacks(tag.text, /<a href="\/packages\/json-parser">/);
    const none = await anon.get('/packages?q=zzzz');
    has(none.text, /No packages found/);
    const byTagText = await anon.get('/packages?q=parser');
    has(byTagText.text, /json-parser/); // matches via tag
    const owner = await anon.get('/packages?owner=testadmin&sort=name');
    has(owner.text, /2 packages found/);
    for (const sort of ['downloads', 'updated', 'newest', 'stars', 'name', 'relevance']) {
      assert.equal((await anon.get(`/packages?sort=${sort}`)).status, 200);
    }
    // special characters must not break the query
    assert.equal((await anon.get("/packages?q=%25_'%22;--")).status, 200);
  });

  it('ranks name matches above other matches when sorting by relevance', async () => {
    const order = (text) => [...String(text).matchAll(/<a href="\/packages\/([a-z0-9-]+)">/g)].map((m) => m[1]);
    // "client" is a tag of http-client and appears in no other package
    const client = order((await anon.get('/packages?q=client&sort=relevance')).text);
    assert.deepEqual(client, ['http-client']);
    // Alphabetical order
    const byName = order((await anon.get('/packages?sort=name')).text);
    assert.deepEqual(byName, ['http-client', 'json-parser']);
    // "http" is a name prefix of http-client
    const http = order((await anon.get('/packages?q=http&sort=relevance')).text);
    assert.equal(http[0], 'http-client');
    // Without a query the default order is by downloads and "relevance" does not fail
    assert.equal((await anon.get('/packages?sort=relevance')).status, 200);
  });

  it('serves the JSON API and counts downloads', async () => {
    const list = JSON.parse((await anon.get('/api/v1/packages?q=json')).text);
    assert.equal(list.total, 1);
    assert.equal(list.packages[0].name, 'json-parser');
    assert.deepEqual(list.packages[0].tags, ['json', 'parser', 'web-server']);
    assert.equal(list.packages[0].latestVersion, '1.2.0');

    const pkg = JSON.parse((await anon.get('/api/v1/packages/json-parser')).text);
    assert.equal(pkg.versions.length, 3);
    const v = pkg.versions.find((x) => x.version === '1.2.0');
    assert.deepEqual(v.dependencies, { 'http-client': '^1.0.0', ghost: '>=1.0.0' });

    const latest = JSON.parse((await anon.get('/api/v1/packages/json-parser/versions/latest')).text);
    assert.equal(latest.version, '1.2.0');
    assert.equal((await anon.get('/api/v1/packages/json-parser/versions/9.9.9')).status, 404);
    assert.equal((await anon.get('/api/v1/packages/nope')).status, 404);
    assert.equal((await anon.get('/api/v1/whatever')).status, 404);

    const dl = await anon.get('/api/v1/packages/json-parser/versions/1.2.0/download');
    assert.equal(dl.status, 302);
    assert.equal(dl.location, 'https://github.com/testadmin/json-parser/archive/refs/tags/v1.2.0.tar.gz');
    await anon.get('/api/v1/packages/json-parser/versions/latest/download');
    const after = JSON.parse((await anon.get('/api/v1/packages/json-parser')).text);
    assert.equal(after.package.downloads, 2);
    assert.equal(after.versions.find((x) => x.version === '1.2.0').downloads, 2);

    const tags = JSON.parse((await anon.get('/api/v1/tags')).text);
    assert.ok(tags.some((t) => t.tag === 'json'));
    const stats = JSON.parse((await anon.get('/api/v1/stats')).text);
    assert.equal(stats.packages, 2);
    assert.equal(stats.maintainers, 1);

    // stats page reflects the downloads
    const page = await anon.get('/packages/json-parser?tab=stats');
    has(page.text, /json-parser: 2 downloads|: 2 downloads/);
  });

  it('lets maintainers manage their packages', async () => {
    const manage = await admin.get('/dashboard/packages/json-parser');
    assert.equal(manage.status, 200);
    has(manage.text, /Last sync: <time class="local-time" datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">\d+ \w{3} \d{4}, \d\d:\d\d UTC<\/time>\./);
    const csrf = admin.csrf(manage.text);
    const saved = await admin.post('/dashboard/packages/json-parser', {
      csrf, action: 'save', description: 'A very fast JSON parser', homepage: 'https://json.example', tags: 'json, fast',
    });
    assert.equal(saved.location, '/dashboard/packages/json-parser?notice=saved');
    const page = await anon.get('/packages/json-parser');
    has(page.text, /A very fast JSON parser/);
    has(page.text, /href="\/packages\?tag=fast"/);
    lacks(page.text, /href="\/packages\?tag=parser"/);

    const badHomepage = await admin.post('/dashboard/packages/json-parser', { csrf, action: 'save', description: 'x', homepage: 'javascript:alert(1)', tags: '' });
    assert.equal(badHomepage.status, 400);

    const before = requestsSeen.length;
    const synced = await admin.post('/dashboard/packages/json-parser', { csrf, action: 'sync' });
    assert.equal(synced.location, '/dashboard/packages/json-parser?notice=synced');
    assert.ok(requestsSeen.length > before);

    const dash = await admin.get('/dashboard');
    has(dash.text, /json-parser/);
    has(dash.text, /Downloads of your packages/);
  });

  it('escapes user-supplied text in the templates', async () => {
    const evil = '<script>alert(1)</script> & "quotes" \'single\'';
    const escaped = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;';
    const csrf = admin.csrf((await admin.get('/dashboard/packages/json-parser')).text);
    const save = (description, homepage = '') =>
      admin.post('/dashboard/packages/json-parser', { csrf, action: 'save', description, homepage, tags: 'json, fast' });

    assert.equal((await save(evil)).status, 303);
    for (const url of ['/', '/packages?q=json', '/packages/json-parser', '/packages/json-parser?tab=stats', '/dashboard', '/admin/packages?q=json']) {
      const page = await admin.get(url);
      assert.equal(page.status, 200, url);
      lacks(page.text, /<script>alert/);
      if (url !== '/dashboard' && url !== '/admin/packages?q=json') has(page.text, new RegExp(escaped.replace(/[()]/g, '\\$&')));
    }

    // The form shows what was typed after a failed save, inside an attribute
    const rejected = await save('"><script>alert(2)</script>', 'javascript:alert(3)');
    assert.equal(rejected.status, 400);
    lacks(rejected.text, /<script>alert/);
    has(rejected.text, /value="&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;"/);

    // Search terms and filters are echoed escaped as well
    const search = await anon.get('/packages?q=' + encodeURIComponent('<b>x</b>') + '&owner=' + encodeURIComponent('"><i>'));
    assert.equal(search.status, 200);
    lacks(search.text, /<b>x<\/b>|"><i>/);
    has(search.text, /&lt;b&gt;x&lt;\/b&gt;/);

    assert.equal((await save('A very fast JSON parser', 'https://json.example')).status, 303);
  });

  it('keeps maintainers out of other people\'s packages and the admin area', async () => {
    await login(bob, 'bob');
    assert.equal((await bob.get('/dashboard')).status, 200);
    assert.equal((await bob.get('/dashboard/packages/json-parser')).status, 404);
    const csrf = bob.csrf((await bob.get('/dashboard')).text);
    assert.ok(csrf);
    assert.equal((await bob.post('/dashboard/packages/json-parser', { csrf, action: 'delete', confirm: 'json-parser' })).status, 404);
    assert.equal((await bob.get('/admin')).status, 403);
    assert.equal((await bob.get('/admin/users')).status, 403);
    assert.equal((await bob.post('/admin/users/1/role', { csrf, role: 'maintainer' })).status, 403);
    assert.equal((await bob.get('/admin/packages/json-parser')).status, 403);
  });

  it('gives admins an overview, user management and package management', async () => {
    const home = await admin.get('/admin');
    assert.equal(home.status, 200);
    has(home.text, /Administration/);
    has(home.text, /Downloads per day/);
    has(home.text, /Top packages/);

    const users = await admin.get('/admin/users');
    has(users.text, /testadmin/);
    has(users.text, /bob/);
    const csrf = admin.csrf(users.text);
    const search = await admin.get('/admin/users?q=bo');
    has(search.text, /bob/);
    lacks(search.text, /<strong>testadmin<\/strong>/);

    const [[bobRow]] = await conn.query("SELECT id FROM users WHERE login = 'bob'");
    const [[meRow]] = await conn.query("SELECT id FROM users WHERE login = 'testadmin'");

    assert.equal((await admin.post(`/admin/users/${meRow.id}/status`, { csrf, status: 'suspended' })).status, 400);
    assert.equal((await admin.post(`/admin/users/${bobRow.id}/role`, { csrf, role: 'wizard' })).status, 400);
    assert.equal((await admin.post(`/admin/users/${bobRow.id}/role`, { csrf: 'bad', role: 'admin' })).status, 403);

    assert.equal((await admin.post(`/admin/users/${bobRow.id}/role`, { csrf, role: 'admin' })).location, '/admin/users?notice=saved');
    assert.equal((await bob.get('/admin')).status, 200);
    await admin.post(`/admin/users/${bobRow.id}/role`, { csrf, role: 'maintainer' });
    assert.equal((await bob.get('/admin')).status, 403);

    // suspending signs the user out
    await admin.post(`/admin/users/${bobRow.id}/status`, { csrf, status: 'suspended' });
    assert.equal((await bob.get('/dashboard')).location, '/auth/github');
    const again = await login(bob, 'bob').catch(() => null);
    assert.equal(again?.location, '/?error=suspended');
    await admin.post(`/admin/users/${bobRow.id}/status`, { csrf, status: 'active' });
    await login(bob, 'bob');
    assert.equal((await bob.get('/dashboard')).status, 200);

    // admin package management
    const list = await admin.get('/admin/packages?q=json');
    has(list.text, /json-parser/);
    const edit = await admin.get('/admin/packages/json-parser');
    assert.equal(edit.status, 200);
    has(edit.text, /Maintainer \(GitHub login\)/);
    const renamed = await admin.post('/admin/packages/json-parser', {
      csrf, action: 'save', name: 'json-parser', repo: 'testadmin/json-parser', maintainer: 'bob', description: 'Now owned by bob', homepage: '', tags: 'json',
    });
    assert.equal(renamed.location, '/admin/packages/json-parser?notice=saved');
    has((await anon.get('/packages/json-parser')).text, /Now owned by bob/);
    assert.equal((await bob.get('/dashboard/packages/json-parser')).status, 200);
    const unknownOwner = await admin.post('/admin/packages/json-parser', {
      csrf, action: 'save', name: 'json-parser', repo: 'testadmin/json-parser', maintainer: 'nobody', description: 'x', homepage: '', tags: '',
    });
    assert.equal(unknownOwner.status, 409);
    const clash = await admin.post('/admin/packages/json-parser', {
      csrf, action: 'save', name: 'http-client', repo: 'testadmin/json-parser', maintainer: 'bob', description: 'x', homepage: '', tags: '',
    });
    assert.equal(clash.status, 409);

    // create on behalf of someone
    const createForm = await admin.get('/admin/packages/new');
    assert.equal(createForm.status, 200);
    const missingMaintainer = await admin.post('/admin/packages/new', { csrf, repo: 'testadmin/http-client', maintainer: 'ghosty', name: 'http-client-2' });
    assert.equal(missingMaintainer.status, 409);
  });

  it('deletes packages only with confirmation', async () => {
    const csrf = admin.csrf((await admin.get('/dashboard/packages/http-client')).text);
    const wrong = await admin.post('/dashboard/packages/http-client', { csrf, action: 'delete', confirm: 'oops' });
    assert.equal(wrong.status, 400);
    const ok = await admin.post('/dashboard/packages/http-client', { csrf, action: 'delete', confirm: 'http-client' });
    assert.equal(ok.location, '/dashboard?notice=deleted');
    assert.equal((await anon.get('/packages/http-client')).status, 404);
    const [[count]] = await conn.query('SELECT COUNT(*) AS c FROM package_tags WHERE package_id NOT IN (SELECT id FROM packages)');
    assert.equal(count.c, 0);
  });

  it('refreshes stale packages in the background task', async () => {
    await conn.query("UPDATE packages SET synced_at = '2020-01-01 00:00:00'");
    const before = requestsSeen.length;
    const summary = await app.runSyncTask();
    has(summary, /synced 1 packages/);
    assert.ok(requestsSeen.length > before);
    assert.equal(await app.runSyncTask(), 'nothing to sync');
  });

  it('signs out', async () => {
    const csrf = admin.csrf((await admin.get('/dashboard')).text);
    assert.equal((await admin.post('/logout', {})).status, 403);
    const out = await admin.post('/logout', { csrf });
    assert.equal(out.location, '/?notice=signedout');
    assert.equal((await admin.get('/dashboard')).location, '/auth/github');
  });

  it('serves robots, sitemap and opensearch', async () => {
    has((await anon.get('/robots.txt')).text, /Disallow: \/admin/);
    has((await anon.get('/sitemap.xml')).text, /packages\/json-parser/);
    has((await anon.get('/opensearch.xml')).text, /OpenSearchDescription/);
    assert.equal((await anon.get('/docs/publishing')).status, 200);
  });
});
