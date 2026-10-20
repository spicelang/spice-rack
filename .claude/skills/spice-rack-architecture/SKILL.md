---
name: spice-rack-architecture
description: Orientation map of Spice Rack, the Spice package registry — the split between the Spice application logic compiled to WebAssembly (`src/`) and the thin Node.js host (`host/`), the stateless step/effect protocol between them, where each feature lives (routing, auth, GitHub sync, templates, API, migrations) and which file to read first. Use when navigating the codebase, deciding where a change belongs, or understanding how a request flows from the browser to MySQL/GitHub and back.
---

# Spice Rack architecture

Spice Rack is the package registry of the Spice language (<https://rack.spicelang.com>). The application logic is
written in **Spice** and compiled to **WebAssembly** (`build/rack.wasm`); a small **Node.js host** (`host/`) does all
I/O. The README ("How it is built", "Templates") has the long version; this is the map.

## The step / effect protocol (read this first)

The wasm module cannot open sockets, so it is a pure function, called once per *step* of a request:

```
browser ──HTTP──▶ host/app.mjs ──▶ rackStep(envelope JSON) ──▶ wasm (src/main.spice)
                      ▲                                            │
                      └──── host/effects.mjs runs SQL / HTTP ◀──── {"batch": {effects, tx}}  or  {"response": …}
```

- The **envelope** (built in `host/app.mjs`) holds the request, config, `now`, fresh randomness and the `results` of all
  effect batches answered so far. `buildCtx` in `src/core.spice` turns it into a `Ctx`.
- A handler answers with either the next `Batch` of effects (SQL with positional params, or HTTP calls) or the final
  response (`ctx.html`, `ctx.jsonBody`, `ctx.redirect`, …). The host loops up to `MAX_STEPS` (16) per request.
- Nothing survives between steps (the arena allocator in `src/libc.spice` is reset before every call), so a handler
  branches on `ctx.step()` — the number of its own batches already answered — and re-derives everything else from
  `ctx.res(batch, idx)` / `ctx.rows(batch, idx)`. Steps re-run all code before the branch, so keep that part cheap and
  deterministic.
- The session lookup is a batch of its own that runs before routing when a session cookie is present (`ctx.base = 1`);
  `ctx.step()` already subtracts it.
- `host/effects.mjs`: a batch runs its SQL in order on one connection (inside a transaction when `batch.tx = true`) and
  stops at the first error; a batch of only HTTP effects runs concurrently. Outgoing HTTP is restricted to
  `api.github.com`, `github.com` and `raw.githubusercontent.com` (`ALLOWED_HTTP_HOSTS`).
- Background work (the periodic package sync) is a synthetic request with method `TASK` (`src/tasks.spice`), so it
  follows the same protocol.

## Where things live

| Area | File(s) | Notes |
|------|---------|-------|
| wasm exports, router | `src/main.spice` | `rackStep`, `route`, `routeApi`. Every `public` `rack*` function is exported by `scripts/build-wasm.sh` |
| Request context, SQL builder, batches, responses | `src/core.spice` | `Ctx`, `Sql` (`ps`/`pn` = placeholder + param), `Batch`, `Ctx.respond` & friends |
| libc shim for wasm | `src/libc.spice` | Bump allocator, `memcpy`, `strtoll`/`strtod`, … that the Spice runtime needs |
| Shared helpers | `src/util.spice` | String/URL helpers, `isValidPackageName` / `packageNameRule` (single source of the name rule) |
| JSON | `src/json.spice` | `JV` (read-only view of parsed JSON) and `JsonWriter` |
| Templates | `src/template.spice`, `src/layout.spice`, `templates/` | Engine + `View`; `renderPage` wraps a page in `templates/layout.html` |
| Public pages | `src/pages_public.spice`, `src/search.spice` | Home, search, docs, robots/sitemap/OpenSearch |
| Package page | `src/pages_package.spice` | README, versions, dependency tree, stats |
| Sign-in | `src/auth.spice` | GitHub OAuth, sessions (14 days), CSRF token |
| Maintainer dashboard | `src/dashboard.spice` | Create / manage / sync / delete packages (also used by admins via `adminMode`) |
| Admin | `src/admin.spice` | Usage overview, user and package management |
| JSON API | `src/api.spice` | `/api/v1/...`, download counting + redirect to the GitHub archive |
| GitHub sync | `src/github.spice`, `src/tasks.spice` | Releases, README, `spice.toml` (`parseManifestDependencies`), monorepo tag matching |
| Semver | `src/semver.spice` | Constraint rules shared in spirit with Spice Shaker's `src/semver.spice` |
| Code highlighting | `src/highlight.spice` | Spice code blocks in READMEs and changelogs |
| Native unit test entry | `src/tests.spice` | Imports every module so `spice test` runs all `#[test]` functions |
| Host | `host/app.mjs` (HTTP server, step loop, static files, security headers), `runtime.mjs` (wasm wrapper), `effects.mjs`, `database.mjs` (pool, migrations), `templates.mjs`, `avatars.mjs`, `ratelimit.mjs`, `config.mjs` (env vars) | |
| Schema | `db/migrations/NNN_*.sql` | Applied once each, in file name order, on startup (`schema_migrations` table) |
| Browser assets | `public/` | `style.css` and the only scripts: `theme.js`, `dismiss.js`, `local-time.js`, `copy-code.js` (CSP is `script-src 'self'`) |
| Tests | `src/**` `#[test]`, `host/test/templates.test.mjs`, `host/test/e2e.test.mjs` | See `spice-rack-build-test` |
| Deployment | `Dockerfile`, `docker-compose.yml`, `nginx/`, `deployment/`, `scripts/init-tls.sh` | Image builds the wasm with the Spice release in `SPICE_VERSION` |

## Cross-repo contracts

- The manifest format (`spice.toml`) is owned by [Spice Shaker](https://github.com/spicelang/spice-shaker)
  (`media/manifest-spec.md`). The registry only reads registry dependencies of `[dependencies]` / `[dev-dependencies]`.
- Spice Shaker consumes the JSON API (`/api/v1/packages/{name}`, `.../versions/{version}/download`, the `path` field for
  packages in a subdirectory). Changing the API shape breaks the package manager.
- [spicelang/packages](https://github.com/spicelang/packages) is the reference monorepo: tags like `github-v0.2.0`.

## Spice quirks met in this code

Method calls cannot be chained on call results (`a.b().c()` → use a temporary), globals must be `UPPER_CASE`, struct
fields need `public` to be used from another file, and `result` / `p` are reserved as variable names.
