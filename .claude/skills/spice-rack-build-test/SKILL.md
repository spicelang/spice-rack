---
name: spice-rack-build-test
description: Build and test Spice Rack — compile the Spice sources to `build/rack.wasm` with `scripts/build-wasm.sh`, run the native Spice unit tests, the template check and the end-to-end tests (real wasm + throw-away MySQL, mocked GitHub), lint with ESLint/Stylelint, and run the app locally with demo data. Use when building, verifying a change, reproducing a CI failure, or starting the registry locally.
---

# Build and test Spice Rack

CI (`.github/workflows/ci.yml`) runs, in this order: Spice unit tests → wasm build → `npm ci` → lint → host tests
against a MySQL 26.7 service. Reproduce the same sequence locally before pushing.

## Prerequisites

- The Spice compiler. Point `SPICE` at it (`SPICE=/path/to/spice`): a `spice` on the `PATH` may be a different tool.
  The compiler needs its std; with a release archive set `SPICE_STD_DIR=<spice-dir>/std`.
- `wasm-ld` (package `lld`) and `clang`. `build-wasm.sh` also finds `/usr/bin/wasm-ld-*`, or set `WASM_LD`.
- Node.js (CI uses 26; `host/package.json` needs >= 20) and Docker or a local MySQL for the end-to-end tests.

## Spice unit tests (native, fast)

```sh
"$SPICE" test src/tests.spice
```

`src/tests.spice` imports every module, so all `#[test]` functions next to the code run. A new module with tests must
be added to its imports. If tests behave strangely after a struct used inside a `Vector<…>` in other files changed,
build once with `--ignore-cache`.

## Build the WebAssembly module

```sh
scripts/build-wasm.sh                 # -> build/rack.wasm   (OPT=-O0 for a faster debug build)
```

The script uses only the compile step of the Spice driver (the driver would pick `mold`, which cannot link wasm),
parses the object files from the printed linker command and links them with `wasm-ld`. Every `public` function named
`rack*` in `src/` is exported. A Spice compile error is printed and fails the script.

## Host tests

```sh
cd host && npm install
npm test                              # templates.test.mjs always; e2e.test.mjs is skipped without E2E_DB_NAME
```

- `host/test/templates.test.mjs` needs only `build/rack.wasm`: every template must compile, includes must exist and
  no template may be unused.
- `host/test/e2e.test.mjs` drives the real app over HTTP with a mocked `fetch` (GitHub fixtures at the top of the
  file). It **drops every table** in the target database, so the name must end in `_test`:

```sh
docker run -d --name rack-db -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=rack_test \
  -e MYSQL_USER=rack -e MYSQL_PASSWORD=rack -p 3307:3306 mysql:26.7
cd host && E2E_DB_PORT=3307 E2E_DB_NAME=rack_test npm test
```

A render-time template mistake (e.g. unknown filter) ends up as `<!-- template error: … -->` in the page; the e2e tests
fail on it. A new GitHub call needs a fixture in `FIXTURES`, otherwise the mock answers 404.

## Lint

```sh
cd host && npm run lint               # ESLint on host/ and public/*.js, Stylelint on public/style.css
```

## Everything at once

```sh
SPICE=/path/to/spice E2E_DB_PORT=3307 E2E_DB_NAME=rack_test scripts/test.sh   # unit tests + wasm build + host tests
```

`scripts/test.sh` does not lint; run `npm run lint` as well.

## Run locally

```sh
cd host
export DB_PORT=3307 DB_USER=rack DB_PASSWORD=rack DB_NAME=rack_test   # DB_PASSWORD defaults to empty
node dev/seed.mjs                     # migrates, adds demo data and prints a `document.cookie = …` line for an admin session
node server.mjs                       # http://localhost:8080 (PORT to change)
```

The e2e tests drop all tables of their database, so re-seed after running them against the same one.

Templates are read at startup: restart the host after changing one. The wasm module only needs a rebuild when Spice
code changes. Configuration variables are listed in the README ("Configuration") and read in `host/config.mjs`.

## Docker image

```sh
docker build -t spice-rack:dev .      # what the CI "docker" job does; SPICE_VERSION build arg picks the compiler
```

## If the environment cannot run a step

Say so in the PR description (e.g. "e2e tests not run: no MySQL available") instead of silently skipping it.
