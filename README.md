# @orkestrel/sqlite

> A lean, typed, synchronous wrapper over Node's built-in `node:sqlite` — a thin skin on
> `DatabaseSync` / `StatementSync` that exposes prepared statements, transactions, and pragmas,
> with one runtime dependency, `@orkestrel/contract`, for boundary narrowing.

Create a database with the `createSQLiteDatabase` function, call `connect()` to open the handle,
and run SQL through `execute` for a result-less statement or `prepare` for anything that binds
parameters or returns rows. Wrap a set of writes in `transact(scope)` to commit them together,
and branch a caught fault on `error.code` rather than on its message. Part of the `@orkestrel`
line.

Node marks `node:sqlite` experimental. On Node 22.22.2, importing this package
prints `ExperimentalWarning: SQLite is an experimental feature and might change
at any time`.

## Install

```sh
npm install @orkestrel/sqlite
```

## Requirements

- Node.js ^22.18 || >=24.4 (the releases carrying the `timeout`, `isTransaction`, and `readBigInts` options and `StatementSync.iterate`)
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
