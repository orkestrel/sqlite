# @orkestrel/sqlite

A typed, synchronous SQLite wrapper for the `@orkestrel` line — a thin,
zero-dependency skin over Node's built-in `node:sqlite` (`DatabaseSync` /
`StatementSync`) giving prepared statements, transactions, and pragmas. Built
on `@orkestrel/contract` for its boundary narrowing.

## Install

```sh
npm install @orkestrel/sqlite
```

## Requirements

- Node.js >= 24
- `node:sqlite` (Node's built-in SQLite module)
- Server-only — no CommonJS/browser split, single Node-native surface

## Status

Pre-release. The public API documented in [`guides/src/sqlite.md`](guides/src/sqlite.md)
is implemented and covered by tests, but the package has not yet reached a
stable `1.0` release.

## Package

Published as a single Node-only surface per the `exports` field in
`package.json` — one `.` entry backed by a CommonJS build of `src/server`
(required by `node:sqlite`'s CJS-only shape at this Node version).

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
