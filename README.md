# Spice Rack

The package registry for the [Spice](https://github.com/spicelang/spice) programming language, meant to run at
<https://rack.spicelang.com>. Every package is a GitHub repository; its releases are the package versions.

## Features

**Public:** package search with tag/maintainer filters and six sort orders · package pages with the GitHub-rendered README,
an expandable dependency tree (plus "used by"), versions with release date and changelog from GitHub releases, and download/view
statistics with charts · a JSON API · `robots.txt`, `sitemap.xml`, OpenSearch.

**Maintainers** sign in with GitHub, add repositories they have push access to as packages, edit description/tags/homepage,
trigger a sync, delete packages and see their stats.

**Admins** get a usage dashboard (downloads, views, sign-ups, top packages), maintainer account management (promote/demote,
suspend, delete) and package management (create on behalf of a user, edit incl. rename/transfer, delete).

## How it is built

The application logic is written in **Spice** (`src/`) and compiled to **WebAssembly** (`build/rack.wasm`). A WebAssembly module
cannot open sockets or talk to MySQL, so a ~400 line Node.js host (`host/`) does the I/O and nothing else:

```
browser ──HTTP──▶ host/app.mjs ──▶ rackStep(request JSON) ──▶ wasm (Spice)
                      ▲                                           │
                      └──── runs the SQL / GitHub calls ◀──── "effects" (JSON)
```

The wasm module is a pure function. It receives the request, the configuration and the results of earlier effects, and answers
with either the next batch of effects (SQL statements with parameters, HTTP calls to GitHub) or the finished response. Routing,
authentication, authorization, CSRF checks, SQL, JSON, HTML rendering, SVG charts, semver resolution and the GitHub sync are all
Spice code. The UI is server-rendered HTML + one CSS file, no client-side JavaScript.

Because WebAssembly has no libc, `src/libc.spice` provides the handful of C functions the Spice runtime needs (a bump allocator
that is reset for every call, `memcpy`, ...). See `scripts/build-wasm.sh` for why `wasm-ld` is invoked directly.

```
src/            Spice sources (main.spice = router and wasm exports, one file per area; unit tests sit next to the code)
host/           Node.js host, MySQL pool, migrations runner, end-to-end tests (host/test), demo seeding (host/dev)
db/migrations/  MySQL schema
public/         CSS and favicon
```

## Deploying (Linux server with Docker)

1. Create a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with the callback URL
   `https://rack.spicelang.com/auth/github/callback`.
2. `cp .env.example .env` and fill in the passwords, the OAuth client id/secret and `ADMIN_LOGINS` (your GitHub login).
3. Point the DNS record of `DOMAIN` at the server and run `docker compose up -d --build`.

`docker-compose.yml` starts MySQL 8.4 (persistent volume), the app (the `Dockerfile` downloads the Spice release given by
`SPICE_VERSION`, compiles the wasm module and ships it with the Node host) and Caddy, which terminates TLS with an automatic
Let's Encrypt certificate. The schema is migrated on startup. Back up the `db-data` volume (or use `mysqldump`).

Without Caddy (own proxy): publish port 8080 of `app`, set `TRUST_PROXY=1` only if a proxy sets `X-Forwarded-For`.

### Configuration

| Variable | Meaning |
|---|---|
| `BASE_URL` | Public URL (OAuth redirect, sitemap, cookies are `Secure` for https) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth app for sign-in |
| `GITHUB_TOKEN` | optional token for the background sync (raises the API limit from 60 to 5000 requests/hour) |
| `ADMIN_LOGINS` | comma separated GitHub logins that are admins (applied at sign-in) |
| `SYNC_INTERVAL_MINUTES` | how often stale packages (not synced for 6 h, 5 per run) are refreshed |
| `RATE_LIMIT_READ_PER_MINUTE`, `RATE_LIMIT_WRITE_PER_MINUTE` | per-IP limits (600 / 60) |

## Publishing a package

Add a `spice.json` to the repository root (optional, it feeds the dependency tree), create a GitHub release with a semver tag
such as `v1.0.0`, then add the repository in the dashboard. Constraints: `1.2.3`, `^1.2.3`, `~1.2.3`, `1.2.x`, `>=1.0.0, <2.0.0`, `*`.

```json
{ "name": "my-package", "dependencies": { "json-parser": "^1.2.0" }, "devDependencies": { "test-kit": "*" } }
```

The `spice.json` format is defined by this registry (Spice has no package manager manifest yet). Adjust `parseManifestDependencies`
in `src/github.spice` if the format changes.

API: `GET /api/v1/packages?q=&tag=&owner=&sort=&page=` · `/api/v1/packages/{name}` · `/api/v1/packages/{name}/versions/{version|latest}`
· `…/download` (counts the download, redirects to the GitHub archive) · `/api/v1/tags` · `/api/v1/stats`.

## Development

```bash
scripts/build-wasm.sh                 # needs the spice compiler (SPICE=/path/to/spice) and wasm-ld (package lld)
spice test src/tests.spice            # Spice unit tests
cd host && npm install
docker run -d --name rack-db -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=rack_test -e MYSQL_USER=rack -e MYSQL_PASSWORD=rack -p 3307:3306 mysql:8.4
E2E_DB_PORT=3307 E2E_DB_NAME=rack_test npm test   # end-to-end: real wasm + MySQL, mocked GitHub
DB_PORT=3307 DB_NAME=rack_test node dev/seed.mjs  # demo data (+ a ready-made admin session cookie), then: node server.mjs
```

Spice quirks met on the way, in case you touch the code: method calls cannot be chained on call results (`a.b().c()`), globals must be
`UPPER_CASE`, struct fields need `public` to be used from another file, and `result`/`p` are reserved as variable names.

## Notes and limits

* GitHub sessions keep the user's OAuth token (scope `read:user`) in the `sessions` table; it is only used to list the user's
  repositories and to verify push access when creating a package. Sessions last 14 days.
* Downloads are counted per API download request; page views skip obvious bots. There is no de-duplication per client.
* Dependencies in the tree are resolved against the latest version of each package on the registry (with a mismatch badge if
  that version violates the constraint), not with a full solver.
