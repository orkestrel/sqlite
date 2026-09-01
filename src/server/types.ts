// The lean server-native SQLite surface — a typed, synchronous wrapper over
// `node:sqlite`'s `DatabaseSync` / `StatementSync`. It exposes SQLite's native
// power (prepared statements, transactions, pragmas) and nothing the core
// database layer can already express: there is **no** query / filter / sort /
// aggregate builder here (that is the one core engine, running over `scan`), the
// same discipline as the IndexedDB wrapper. The SQLite `DriverInterface` (Chunk
// 3) is built on this wrapper; standalone server code can use it directly. Types
// are the source of truth (AGENTS §2).
//
// Values are SQLite's native types, narrowed at the typed layer above (the
// driver) through a contract, never re-narrowed here (AGENTS §14).

/**
 * A value SQLite stores and returns natively — the SQL ↔ JS bridge.
 *
 * @remarks
 * `node:sqlite` maps `NULL` / `INTEGER` / `REAL` / `TEXT` / `BLOB` to exactly
 * these JS types (integers arrive as `number`, or `bigint` only past 2^53).
 */
export type SQLiteValue = null | number | bigint | string | Uint8Array

/** A result row — a record of column name to {@link SQLiteValue}. */
export type SQLiteRow = Record<string, SQLiteValue>

/**
 * Bind parameters for a prepared statement — positional (an array, bound to `?`)
 * or named (a record, bound to bare `:name` placeholders).
 */
export type SQLiteParameters = readonly SQLiteValue[] | Readonly<Record<string, SQLiteValue>>

/**
 * The normalized binding shape a native `StatementSync` call expects — what
 * {@link SQLiteParameters} become on the way into `node:sqlite`.
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

/** The outcome of a non-query statement (`INSERT` / `UPDATE` / `DELETE` / DDL). */
export interface SQLiteRunResult {
	readonly changes: number
	readonly rowid: number
}

/**
 * A machine-readable {@link SQLiteError} code.
 *
 * @remarks
 * `'BUSY'` is retryable — it means a locked database was still held by another
 * connection when the `timeout` (see {@link SQLiteDatabaseOptions}) elapsed; a
 * caller may retry the operation, typically after backing off briefly.
 */
export type SQLiteErrorCode = 'CLOSED' | 'CONSTRAINT' | 'BUSY' | 'UNKNOWN'

/**
 * Options for `createSQLiteDatabase`.
 *
 * @remarks
 * `path` is the database file path, or the special name `':memory:'` for an
 * in-memory database (the default when omitted). `readonly` opens the
 * connection read-only (native `readOnly`) — an absent file fails to open
 * rather than being created. `timeout` is the busy-timeout in milliseconds
 * (native `timeout`) — how long SQLite retries a locked database before
 * failing with a `BUSY` {@link SQLiteError}; defaults to `0` (fail
 * immediately) when omitted. `foreignKeys` enables foreign-key constraint
 * enforcement (native `enableForeignKeyConstraints`); `node:sqlite` defaults
 * this to `true` when omitted. `bigints` reads `INTEGER` columns back as
 * `bigint` (native `readBigInts`) — writes already accept `bigint` regardless
 * of this option, so a stored integer beyond `Number.MAX_SAFE_INTEGER` throws
 * on read unless `bigints` is enabled; enabling it returns EVERY integer
 * column as `bigint`, not just out-of-range ones, closing that read/write
 * asymmetry at the cost of `bigint` values for ordinary small integers too.
 */
export interface SQLiteDatabaseOptions {
	readonly path?: string
	readonly readonly?: boolean
	readonly timeout?: number
	readonly foreignKeys?: boolean
	readonly bigints?: boolean
}

/**
 * A prepared statement — the only way the wrapper runs SQL (no query DSL; the
 * core database layer owns querying, exactly as the IndexedDB wrapper does).
 *
 * @remarks
 * Reached through `database.prepare(sql)`. Each method binds the optional
 * `parameters` (an array spread to positional `?` placeholders, or a record bound
 * to bare named placeholders) and executes synchronously: `run` for a non-query,
 * `get` for the first row, `all` for every row, `iterate` for a lazy stream. A
 * native fault surfaces as a {@link SQLiteError}.
 */
export interface SQLiteStatementInterface {
	run(parameters?: SQLiteParameters): SQLiteRunResult
	get(parameters?: SQLiteParameters): SQLiteRow | undefined
	all(parameters?: SQLiteParameters): readonly SQLiteRow[]
	iterate(parameters?: SQLiteParameters): IterableIterator<SQLiteRow>
}

/**
 * A synchronous SQLite database over `node:sqlite`'s `DatabaseSync` — a lean,
 * typed, zero-dependency layer exposing prepared statements, transactions, and
 * pragmas. Synchronous because `node:sqlite` is; the SQLite *driver* (Chunk 3)
 * adapts it to the async `DriverInterface`.
 *
 * @remarks
 * Connects lazily — `connect` opens the underlying `DatabaseSync` (idempotent),
 * and every operation requires an open connection, throwing a `CLOSED`
 * {@link SQLiteError} before `connect` or after `close`. `exec` runs SQL with no
 * results (DDL, pragmas); `prepare` compiles a {@link SQLiteStatementInterface};
 * `transaction` runs a scope between `BEGIN` and `COMMIT`, rolling back on a
 * throw; `pragma` reads (or sets then reads) a single PRAGMA value — `name` is
 * trusted internal use only, never untrusted input, since pragma names cannot
 * be bound as parameters. `transacting` reports whether a transaction is
 * currently open on this connection — node:sqlite's `isTransaction` (wraps
 * `sqlite3_get_autocommit()`); `false` when not connected. `begin` / `commit` /
 * `rollback` are the same `BEGIN` / `COMMIT` / `ROLLBACK` primitives
 * `transaction` composes internally, exposed directly for a long-lived or
 * externally-driven transaction that a single synchronous scope cannot
 * express — `transaction(scope)` remains the right tool whenever the whole
 * transaction fits in one synchronous scope. `[Symbol.dispose]` closes the
 * connection (same as `close`), enabling `using` to release it
 * deterministically at the end of a block.
 */
export interface SQLiteDatabaseInterface {
	readonly path: string
	readonly connected: boolean
	readonly transacting: boolean
	connect(): void
	close(): void
	exec(sql: string): void
	prepare(sql: string): SQLiteStatementInterface
	transaction<R>(scope: () => R): R
	/**
	 * Open a transaction (`BEGIN`). Throws the native fault — including a
	 * nested `BEGIN` while one is already open — as a {@link SQLiteError}; a
	 * caller composing its own transaction alongside others should branch on
	 * {@link SQLiteDatabaseInterface.transacting} first rather than catch this
	 * (see the Practices section in `guides/sqlite.md`).
	 */
	begin(): void
	/** Commit the currently open transaction (`COMMIT`); throws the native fault as a {@link SQLiteError} when none is open. */
	commit(): void
	/** Roll back the currently open transaction (`ROLLBACK`); throws the native fault as a {@link SQLiteError} when none is open. */
	rollback(): void
	pragma(name: string, value?: string | number): SQLiteValue | undefined
	[Symbol.dispose](): void
}
