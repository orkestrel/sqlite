# @orkestrel/sqlite

A typed, synchronous SQLite wrapper for the `@orkestrel` line — a thin skin
over Node's built-in `node:sqlite` (`DatabaseSync` / `StatementSync`) giving
prepared statements, transactions, and pragmas, with a single runtime
dependency: `@orkestrel/contract`, used for its boundary narrowing.

Node marks `node:sqlite` experimental. On Node 22.22.2, importing this package
prints `ExperimentalWarning: SQLite is an experimental feature and might change
at any time`.

## Install

```sh
npm install @orkestrel/sqlite
```

## Requirements

- Node.js >= 22.12
- `node:sqlite` (Node's built-in SQLite module)
- Server-only — no browser build

## Status

Pre-release. The public API documented in
[`guides/sqlite.md`](https://github.com/orkestrel/sqlite/blob/main/guides/sqlite.md)
is implemented and covered by tests, but the package has not yet reached a
stable `1.0` release.

## Package

Published as a single Node-only surface per the `exports` field in
`package.json` — one `.` entry that serves an ES module to `import` and a
CommonJS build to `require`, both built from `src/server`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
