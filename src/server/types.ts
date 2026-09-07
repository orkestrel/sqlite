// The lean server-native SQLite surface — a typed, synchronous wrapper over
// `node:sqlite`'s `DatabaseSync` / `StatementSync`. It exposes SQLite's native
// power (prepared statements, transactions, pragmas) and nothing the core
// database layer can already express: there is **no** query / filter / sort /
// aggregate builder here (that is the one core engine, running over `scan`), the
// same discipline as the IndexedDB wrapper. `@orkestrel/database`'s SQLite driver
// is built on this wrapper; standalone server code can use it directly. Types are
// the source of truth.
//
// Values are SQLite's native types, narrowed at the typed layer above (that
// package's driver) through a contract, never re-narrowed here.

/**
 * Represents a value SQLite stores and returns natively — the SQL ↔ JS bridge over `null`,
 * `number`, `bigint`, `string`, and `Uint8Array`.
 *
 * @remarks
 * `node:sqlite` maps `NULL` / `INTEGER` / `REAL` / `TEXT` / `BLOB` to exactly
 * these JS types (integers arrive as `number`, or `bigint` only past 2^53).
 */
export type SQLiteValue = null | number | bigint | string | Uint8Array

/** Represents a result row — a record of column name to {@link SQLiteValue}. */
export type SQLiteRow = Record<string, SQLiteValue>

/**
 * Represents the bind parameters for a prepared statement — positional (an array, bound to `?`)
 * or named (a record, bound to bare `:name` placeholders).
 */
export type SQLiteParameters = readonly SQLiteValue[] | Readonly<Record<string, SQLiteValue>>

/**
 * Represents the normalized binding shape a native `StatementSync` call expects —
 * `{ positional }` or `{ named }`, what {@link SQLiteParameters} become on the way into
 * `node:sqlite`.
 *
 * @remarks
 * `positional` carries an array spread into the native call against `?`
 * placeholders; `named` carries a record passed as a single leading object bound
 * to bare `:name` placeholders. The discriminant is the present member, so a
 * consumer branches with `'named' in binding` and stays typed against the native
 * overloads without an assertion.
 */
export type SQLiteBinding =
	| { readonly positional: readonly SQLiteValue[] }
	| { readonly named: Readonly<Record<string, SQLiteValue>> }

/**
 * Represents the outcome of a non-query statement (`INSERT` / `UPDATE` / `DELETE` / DDL) — its
 * `changes` and `rowid`.
 *
 * @remarks
 * Each member is a `number`, so a count or a rowid past 2^53 truncates — acceptable for the
 * keys and change counts this layer hands back, and a caller needing exact large keys reads
 * them back through a `bigints` connection instead.
 */
export interface SQLiteExecuteResult {
	readonly changes: number
	readonly rowid: number
}

/**
 * Represents a machine-readable {@link SQLiteError} code.
 *
 * @remarks
 * `'BUSY'` is retryable — it means a locked database was still held by another
 * connection when the `timeout` (see {@link SQLiteDatabaseOptions}) elapsed; a
 * caller may retry the operation, typically after backing off briefly.
 * `'INVALID'` is the wrapper's own invalid-argument fault, refused before any SQL
 * runs, and stays distinct from `'UNKNOWN'`, which carries an unclassified native
 * `node:sqlite` fault.
 */
export type SQLiteErrorCode = 'CLOSED' | 'CONSTRAINT' | 'BUSY' | 'INVALID' | 'UNKNOWN'

/**
 * Represents the options for `createSQLiteDatabase` — `path`, `readonly`, `timeout`,
 * `foreignKeys`, and `bigints`.
 *
 * @remarks
 * `path` is the database file path, or the special name `':memory:'` for an
 * in-memory database (the default when omitted). `readonly` opens the
 * connection read-only (native `readOnly`) — an absent file fails to open
 * rather than being created. `timeout` is the busy-timeout in milliseconds
 * (native `timeout`) — how long SQLite retries a locked database before
 * failing with a `BUSY` {@link SQLiteError}; defaults to `0` (fail
 * immediately) when omitted. `foreignKeys` enables foreign-key constraint
 * enforcement (native `enableForeignKeyConstraints`) and mirrors SQLite's
 * `PRAGMA foreign_keys` statement; `node:sqlite` defaults this to `true` when
 * omitted. `bigints` reads `INTEGER` columns back as `bigint` (native
 * `readBigInts`) — writes already accept `bigint` regardless of this option,
 * so a stored integer beyond `Number.MAX_SAFE_INTEGER` throws on read unless
 * `bigints` is enabled; enabling it returns EVERY integer column as `bigint`,
 * not out-of-range ones alone, closing that read/write asymmetry at the cost of
 * `bigint` values for ordinary small integers too.
 */
export interface SQLiteDatabaseOptions {
	readonly path?: string
	readonly readonly?: boolean
	readonly timeout?: number
	readonly foreignKeys?: boolean
	readonly bigints?: boolean
}

/**
 * Represents a prepared statement — the only way the wrapper runs SQL.
 *
 * @remarks
 * There is no query DSL here: the core database layer owns querying, exactly as the
 * IndexedDB wrapper does. Reached through `database.prepare(sql)`. Each method binds the optional
 * `parameters` (an array spread to positional `?` placeholders, or a record bound
 * to bare named placeholders) and runs synchronously: `execute` for a non-query,
 * `get` for the first row, `all` for every row, `iterate` for a lazy stream. A
 * native fault surfaces as a {@link SQLiteError}; a fault raised while finalizing
 * an `iterate` stream on any exit after its first step is discarded instead, so
 * leaving the loop never throws.
 */
export interface SQLiteStatementInterface {
	/** Runs a non-query (`INSERT` / `UPDATE` / `DELETE` / DDL) and returns its `changes` and `rowid`. */
	execute(parameters?: SQLiteParameters): SQLiteExecuteResult
	/** Runs the statement and returns its first row, or `undefined` when none matched. */
	get(parameters?: SQLiteParameters): SQLiteRow | undefined
	/** Runs the statement and returns every matching row eagerly, as an array. */
	all(parameters?: SQLiteParameters): readonly SQLiteRow[]
	/** Streams the matching rows lazily, one row materialized at a time, for a large result set. */
	iterate(parameters?: SQLiteParameters): IterableIterator<SQLiteRow>
}

/**
 * Represents the contract a synchronous SQLite database fulfills over `node:sqlite`'s
 * `DatabaseSync` — prepared statements, transactions, and pragmas, every call returning a
 * plain value rather than a `Promise`.
 *
 * @remarks
 * A lean, typed layer whose one runtime dependency is `@orkestrel/contract`. Synchronous
 * because `node:sqlite` is; `@orkestrel/database`'s SQLite driver adapts it to that
 * package's asynchronous driver contract. Connects lazily — `connect` opens the underlying
 * `DatabaseSync` (idempotent), and every operation requires an open connection, throwing a
 * `CLOSED` {@link SQLiteError} before `connect` or after `close`. `pragma`'s `name` is
 * trusted internal use only, never untrusted input, because pragma names cannot be bound as
 * parameters. `transacting` reports whether a transaction is open on this connection —
 * node:sqlite's `isTransaction` (wraps `sqlite3_get_autocommit()`); `false` when not
 * connected. `begin` / `commit` / `rollback` are the same `BEGIN` / `COMMIT` / `ROLLBACK`
 * primitives `transact` composes internally, exposed directly for a long-lived or
 * externally-driven transaction that a single synchronous scope cannot express —
 * `transact(scope)` remains the right tool whenever the whole transaction fits in one
 * synchronous scope. `[Symbol.dispose]` closes the connection (same as `close`), enabling
 * `using` to release it deterministically at the end of a block.
 */
export interface SQLiteDatabaseInterface {
	readonly path: string
	readonly connected: boolean
	readonly transacting: boolean
	/** Opens the underlying connection — lazy and idempotent, so a second call is a no-op. */
	connect(): void
	/** Releases the connection; afterward every operation gates `CLOSED` until reconnect. */
	close(): void
	/** Runs one or more result-less SQL statements (DDL, pragmas) in a single call. */
	execute(sql: string): void
	/** Compiles SQL into a reusable prepared statement — the only path that runs queries. */
	prepare(sql: string): SQLiteStatementInterface
	/** Runs `scope` between `BEGIN` and `COMMIT`, rolling the whole scope back and rethrowing on a throw. */
	transact<R>(scope: () => R): R
	/**
	 * Opens a transaction (`BEGIN`); throws the native fault, a nested `BEGIN` included, as a {@link SQLiteError}.
	 *
	 * @remarks
	 * Branch on {@link SQLiteDatabaseInterface.transacting} first rather than catching this
	 * when composing a transaction alongside others (see the Practices section in
	 * `guides/sqlite.md`).
	 */
	begin(): void
	/** Commits the open transaction (`COMMIT`); throws the native fault as a {@link SQLiteError} when none is open. */
	commit(): void
	/** Rolls back the open transaction (`ROLLBACK`); throws the native fault as a {@link SQLiteError} when none is open. */
	rollback(): void
	/** Reads a single PRAGMA, or sets then reads it when a `value` is passed. */
	pragma(name: string, value?: string | number): SQLiteValue | undefined
	[Symbol.dispose](): void
}
