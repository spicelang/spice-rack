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
authentication, authorization, CSRF checks, SQL, JSON, HTML rendering, semver resolution and the GitHub sync are all Spice code.
The markup is not: it lives in `templates/` and is rendered by a small template engine (see [Templates](#templates)). The UI is
server-rendered HTML + one CSS file; the only scripts are `public/theme.js` (light/dark switch, remembered in `localStorage`) and
`public/local-time.js` (shows times of day in the visitor's timezone).

Because WebAssembly has no libc, `src/libc.spice` provides the handful of C functions the Spice runtime needs (a bump allocator
that is reset for every call, `memcpy`, ...). See `scripts/build-wasm.sh` for why `wasm-ld` is invoked directly.

```
src/            Spice sources (main.spice = router and wasm exports, one file per area; unit tests sit next to the code)
templates/      HTML and XML templates for every page, partial and feed
host/           Node.js host, MySQL pool, migrations runner, end-to-end tests (host/test), demo seeding (host/dev)
db/migrations/  MySQL schema, applied in file name order on startup (tracked in the `schema_migrations` table)
public/         CSS, the two scripts and favicons
deployment/     Compose setup for a server that already runs nginx-proxy (production + staging)
```

## Templates

All markup is in `templates/`; the Spice code only prepares data. A handler binds names to values and renders a template inside
the layout (`templates/layout.html`):

```spice
View view;
view.bind("results", rows);                     // database rows are bound as they are
view.json("pager", paginationJson(...));        // small view models are assembled with a JsonWriter
view.flag("single", total == 1l);
return ctx.html(200, renderPage(ctx, "pages/search", title, description, view));
```

```html
{% for r in results %}{% include "partials/package-card" with pkg=r %}{% endfor %}
<p>{{ total|thousands }}{% if single %} package{% else %} packages{% endif %} found</p>
```

| Syntax | Meaning |
|---|---|
| `{{ user.login }}` | value, **HTML-escaped**; missing values render as nothing |
| `{{{ readme_html }}}` | value without escaping, only for markup that GitHub already sanitized |
| `{{ x\|filter }}` | filters, chained: `url`, `count` (12.4k), `thousands`, `date`, `datetime`, `dayshort`, `isoutc`, `lower`, `head:10`, `prefix:"v"`, `split` (comma separated text to a list), `default:"text"`, `raw` |
| `{% if a and not b %}` … `{% elif a == "x" %}` … `{% else %}` … `{% endif %}` | conditions: paths, `not`, `==`, `!=`, `and`, `or` (no parentheses) |
| `{% for x in list %}` … `{% else %}` … `{% endfor %}` | loops; inside: `loop.index`, `loop.index0`, `loop.first`, `loop.last`, `loop.length` |
| `{% include "partials/tile" with value=x label="Text" %}` | partial; sees the current scope plus the arguments. The name can be a variable (`{% include page %}`); includes may recurse (dependency tree) |
| `{# comment #}` | |

Indentation is removed from the output: whitespace with a line break between two tags (or a tag and a template tag) disappears.
A space between inline elements has to stay on one line. The host packs `templates/` into the wasm memory at startup
(`host/templates.mjs`), the module compiles a template when it first needs it, and the host refuses to start if one is broken.
`host/test/templates.test.mjs` checks the same without a database, and also fails for templates nothing uses. A mistake that only
shows at render time (unknown filter) ends up as `<!-- template error: … -->` at the end of the page; the e2e tests fail on it.

## Deploying (Linux server with Docker)

1. Create a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with the callback URL
   `https://rack.spicelang.com/auth/github/callback`.
2. `cp .env.example .env` and fill in the passwords, the OAuth client id/secret and `ADMIN_LOGINS` (your GitHub login).
3. Point the DNS record of `DOMAIN` at the server (ports 80 and 443 open) and run `scripts/init-tls.sh` once to obtain the
   Let's Encrypt certificate, then `docker compose up -d --build`. Certificates are stored in `./data/letsencrypt` and renewed by
   the `certbot` service; nginx reloads every 6 hours to pick them up.
   For local use, `DOMAIN=localhost scripts/init-tls.sh` creates a self-signed certificate instead.

`docker-compose.yml` starts MySQL 26.7 (persistent volume), the app (the `Dockerfile` downloads the Spice release given by
`SPICE_VERSION`, compiles the wasm module and ships it with the Node host) and nginx, which terminates TLS (Let's Encrypt via
certbot, renewed automatically). The schema is migrated on startup. Back up `./volumes/mysql-data` (or use `mysqldump`).

Without nginx (own proxy): publish port 8080 of `app`, set `TRUST_PROXY=1` only if a proxy sets `X-Forwarded-For`.

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
docker run -d --name rack-db -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=rack_test -e MYSQL_USER=rack -e MYSQL_PASSWORD=rack -p 3307:3306 mysql:26.7
E2E_DB_PORT=3307 E2E_DB_NAME=rack_test npm test   # end-to-end: real wasm + MySQL, mocked GitHub
DB_PORT=3307 DB_NAME=rack_test node dev/seed.mjs  # demo data (+ a ready-made admin session cookie), then: node server.mjs
```

```bash
cd host && npm run lint               # ESLint (host, scripts in public/) and Stylelint (public/style.css); runs in CI as well
scripts/test.sh                       # Spice unit tests + wasm build + host tests in one go (set SPICE=... and E2E_DB_* first)
```

Schema changes go into a new, numbered file in `db/migrations/` (never edit one that was already released). Package names must be
lower kebab-case; the rule lives in `isValidPackageName` / `packageNameRule` in `src/util.spice`, so forms and error messages
cannot drift from the check. On startup the host logs a warning for packages whose names predate that rule.

Template files are read at startup, so restart the host after changing one (the wasm module only needs a rebuild when Spice code
changes). Spice quirks met on the way, in case you touch the code: method calls cannot be chained on call results (`a.b().c()`), globals must be
`UPPER_CASE`, struct fields need `public` to be used from another file, and `result`/`p` are reserved as variable names. If tests behave
strangely after a struct that other files use inside a `Vector<…>` changed, build once with `--ignore-cache`.

## Notes and limits

* GitHub sessions keep the user's OAuth token (scope `read:user`) in the `sessions` table; it is only used to list the user's
  repositories and to verify push access when creating a package. Sessions last 14 days.
* Downloads are counted per API download request; page views skip obvious bots. There is no de-duplication per client.
* Dependencies in the tree are resolved against the latest version of each package on the registry (with a mismatch badge if
  that version violates the constraint), not with a full solver.
