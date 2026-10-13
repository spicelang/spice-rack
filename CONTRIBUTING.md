# Contributing
Spice Rack is a community-driven project. This means that we are open for feature requests or suggestions for improvement.
Apart from that, feel free to fork this project and send us some code contributions via pull request.

In every case please read the [Code of Conduct](https://github.com/spicelang/spice-rack/blob/main/CODE_OF_CONDUCT.md) before contributing.

## Security issues
Please do **not** open issues on GitHub! Please read our [Security Policy](https://github.com/spicelang/spice-rack/blob/main/SECURITY.md) and contact us via non-public ways, e.g. per mail: [contact@chillibits.com](mailto:contact@chillibits.com).

## Feature request and bugs
If you want to contribute by reporting a bug (except a security issue) or you want to send in a feature request, please navigate to the [issues section](https://github.com/spicelang/spice-rack/issues). Issues that are easy to work on and appropriate for beginners are marked as 'good first issue'. Feel free to claim one of those issues by commenting that you want to do so. After we assign you to the issue, you can start working on the problem / feature request. Please open a pull request qhen you're done with the work and please only work on one issue at once.

## Development setup
The [Development section of the README](https://github.com/spicelang/spice-rack#development) has the exact commands. In short:

* You need the Spice compiler and `wasm-ld` (package `lld`). Make sure `SPICE=/path/to/spice` points at the real compiler, because a `spice` on your `PATH` may be a different tool.
* `scripts/test.sh` runs the Spice unit tests, builds the WebAssembly module and runs the host tests. Set `E2E_DB_NAME=<name>_test` (plus `E2E_DB_PORT` etc.) to include the end-to-end tests against a throw-away MySQL database. All tables in that database are dropped.
* If tests behave strangely after you changed a struct that other files use, rebuild once with `--ignore-cache`.
* `cd host && npm run lint` runs ESLint and Stylelint. CI runs it as well.
* Schema changes go into a new numbered file in `db/migrations/`. Never edit a migration that was already released.
