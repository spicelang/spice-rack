---
name: spice-rack-add-route
description: Recipe for adding or changing a page, form action, JSON API endpoint or background task in Spice Rack — route it in `src/main.spice`, write a step-based handler that requests SQL/HTTP effect batches and renders a template or JSON, add the template under `templates/`, a schema migration if needed, and the unit/e2e tests. Covers auth, CSRF, parameterized SQL and the pitfalls of the stateless step model. Use when implementing a feature that touches request handling.
---

# Add a route / handler to Spice Rack

Read `spice-rack-architecture` first for the step/effect protocol. The checklist:

1. **Route** it in `route` / `routeApi` (`src/main.spice`). Validate path segments there (e.g. `isValidPackageName`)
   and pass decoded values (`urlDecode`) to the handler.
2. **Handler** `public f<String> handleX(Ctx& ctx)` in the module of its area (see the table in
   `spice-rack-architecture`); a new module must be imported by `src/main.spice` *and* `src/tests.spice`.
3. **Template** in `templates/pages/…` (partials in `templates/partials/`), syntax in the README section "Templates".
4. **Migration** in `db/migrations/` if the schema changes.
5. **Tests**: `#[test]` functions for pure logic, an `it(…)` in `host/test/e2e.test.mjs` for the request.

## Handler shape

```spice
public f<String> handleThing(Ctx& ctx, const String& name) {
    // Guards first: they run again on every step, so keep them cheap and deterministic
    if !ctx.user.present { return requireLogin(ctx); }

    if ctx.step() == 0 {
        Batch batch;
        Sql sql = Sql("SELECT id, description FROM packages WHERE name = ");
        sql.ps(name);                       // placeholder + parameter; never concatenate values into SQL
        batch.query(sql);
        return batch.finish();              // host runs it and calls rackStep again with the results
    }
    JV rows = ctx.rows(0, 0l);              // batch 0, effect 0
    if rows.size() == 0l { return notFound(ctx); }
    JV pkg = rows.first();

    View view;
    view.bind("pkg", pkg);                  // rows are bound as they are
    view.flag("owner", pkg.getNum("owner_id") == ctx.user.id);
    return ctx.html(200, renderPage(ctx, "pages/thing", String("Title"), String("Description"), view));
}
```

- Each later step repeats the code above its branch, so read earlier results again with `ctx.rows(n, i)` /
  `ctx.res(n, i)` instead of keeping state. `ctx.failed(n, i)` / `ctx.errorCode(n, i)` report a failed effect
  (e.g. `ER_DUP_ENTRY`); after a failing SQL effect the rest of that batch is skipped.
- Several statements that must succeed together go into one batch with `batch.tx = true`.
- A request may take at most 16 steps (`MAX_STEPS` in `host/app.mjs`).
- HTTP effects: `batch.http("GET", url, accept, token)`. Only GitHub hosts are allowed by `host/effects.mjs`; a new
  host has to be added to `ALLOWED_HTTP_HOSTS` deliberately. A batch with only HTTP effects runs them concurrently.
- Responses: `ctx.html`, `ctx.jsonBody`, `ctx.text`, `ctx.redirect` (303, use after a POST), `withNotice(path,
  "saved")` for the green notice after a redirect; `notFound`, `forbidden`, `badRequest` (`src/layout.spice`) for errors.

## Auth and forms

- `ctx.user.present` (else `requireLogin(ctx)`), `ctx.isAdmin()`; owners are checked against `owner_id` (see `src/dashboard.spice`).
- Every state-changing POST checks `ctx.csrfOk()` and returns `forbidden(ctx)` otherwise; forms include
  `{% include "partials/csrf" %}`. Read fields with `ctx.formTrim("field")` / `ctx.form.get("field")`.
- Name rules come from `src/util.spice` (`isValidPackageName`, `packageNameRule`), so forms and errors cannot drift.

## Templates

- `{{ x }}` escapes; `{{{ x }}}` is only for HTML GitHub already sanitized (README, release notes).
- Small view models are built with `view.json("name", jsonText)` from a `JsonWriter`.
- `host/test/templates.test.mjs` fails for templates nothing includes, so remove a template together with its last use.
- New browser JavaScript must be a file in `public/` (the CSP forbids inline scripts) and be listed in the comment of
  the `Content-Security-Policy` in `host/app.mjs` and the README.

## JSON API

`/api/v1/...` is read-only (POST answers 405) and consumed by Spice Shaker (`src/registry.spice` there). Add fields
rather than renaming or removing them.

## Background tasks

Timer-driven work is routed under method `TASK` in `route` (see `handleSyncTask` in `src/tasks.spice`) and triggered
by the host on `SYNC_INTERVAL_MINUTES`.

## Migrations

New numbered file (`003_….sql`), applied once on startup in file name order. Never edit a migration that was already
released; write a new one that alters the schema.

## Tests

- e2e: sign in with the existing clients (`admin`, `bob`, `anon`), add any GitHub responses the handler needs to
  `FIXTURES`, then assert on status, headers and HTML. Run as described in `spice-rack-build-test`.
- Update the README when routes, API, configuration or user-visible behavior change.
