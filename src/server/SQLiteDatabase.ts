import type {
	SQLiteDatabaseInterface,
	SQLiteDatabaseOptions,
	SQLiteStatementInterface,
	SQLiteValue,
} from './types.js'
import { DatabaseSync } from 'node:sqlite'
import {
	attempt,
	isDefined,
	isFailure,
	isPromiseLike,
	isUndefined,
	preview,
} from '@orkestrel/contract'
import { SQLiteError } from './errors.js'
import { wrapError } from './helpers.js'
import { SQLiteStatement } from './SQLiteStatement.js'
import { isPragmaName, isPragmaValue } from './validators.js'

/**
 * Implements {@link SQLiteDatabaseInterface} over a lazily opened `DatabaseSync` the instance
 * owns, gating every operation on that connection and mapping each native fault to a
 * {@link SQLiteError}.
 *
 * @remarks
 * Created by `createSQLiteDatabase`. The gate throws a `CLOSED` fault before `connect` or
 * after `close`, and `connect` itself is idempotent.
 * `execute` runs result-less SQL; `prepare` compiles a `SQLiteStatement`;
 * `transact` wraps a scope in `BEGIN` / `COMMIT`, rolling back on a throw;
 * `begin` / `commit` / `rollback` expose those same primitives directly for a
 * long-lived or externally-driven transaction; `pragma` reads (or sets then
 * reads) one PRAGMA value after {@link isPragmaName} and {@link isPragmaValue} admit
 * its input. `transacting` reports whether a transaction is open
 * (node:sqlite's `isTransaction`), `false` when not connected.
 *
 * @example
 * ```ts
 * import { SQLiteDatabase } from '@orkestrel/sqlite'
 *
 * const db = new SQLiteDatabase({ path: ':memory:' })
 * db.connect()
 * db.pragma('user_version') // 0
 * ```
 */
export class SQLiteDatabase implements SQLiteDatabaseInterface {
	readonly #path: string
	readonly #readonly: boolean | undefined
	readonly #timeout: number | undefined
	readonly #foreignKeys: boolean | undefined
	readonly #bigints: boolean | undefined
	#database: DatabaseSync | undefined

	constructor(options: SQLiteDatabaseOptions) {
		this.#path = options.path ?? ':memory:'
		this.#readonly = options.readonly
		this.#timeout = options.timeout
		this.#foreignKeys = options.foreignKeys
		this.#bigints = options.bigints
	}

	get path(): string {
		return this.#path
	}

	get connected(): boolean {
		return isDefined(this.#database)
	}

	get transacting(): boolean {
		return this.#database?.isTransaction ?? false
	}

	connect(): void {
		if (isUndefined(this.#database)) {
			this.#database = new DatabaseSync(this.#path, {
				readOnly: this.#readonly,
				timeout: this.#timeout,
				enableForeignKeyConstraints: this.#foreignKeys,
				readBigInts: this.#bigints,
			})
		}
	}

	close(): void {
		this.#database?.close()
		this.#database = undefined
	}

	/** Closes the connection — enables `using db = createSQLiteDatabase(...)`. */
	[Symbol.dispose](): void {
		this.close()
	}

	execute(sql: string): void {
		try {
			this.#require().exec(sql)
		} catch (error) {
			throw wrapError(error)
		}
	}

	prepare(sql: string): SQLiteStatementInterface {
		try {
			const database = this.#require()
			// Capture this specific connection instance — a later `close()` clears
			// `#database`, and a subsequent `connect()` creates a NEW instance, so
			// identity comparison (not "is a connection open" alone) keeps a statement
			// prepared on the OLD connection permanently CLOSED after reconnect.
			return new SQLiteStatement(database.prepare(sql), () => this.#database !== database)
		} catch (error) {
			throw wrapError(error)
		}
	}

	transact<R>(scope: () => R): R {
		this.begin()
		const outcome = attempt(scope)
		if (isFailure(outcome)) {
			// A ROLLBACK fault, such as a connection the scope closed, never masks the scope's own error.
			attempt(() => this.rollback())
			throw outcome.error
		}
		const result = outcome.value
		if (isPromiseLike(result)) {
			// An async scope returns before its awaited work runs, so committing here
			// would commit prematurely — roll back and reject instead of silently
			// racing the caller's still-pending work. A ROLLBACK fault never masks the refusal.
			attempt(() => this.rollback())
			throw new SQLiteError(
				'INVALID',
				'transact(scope) requires a synchronous scope — an async or Promise-returning scope cannot commit or roll back before its awaited work runs; use begin() / commit() / rollback() directly for a transaction that spans async caller code',
			)
		}
		this.commit()
		return result
	}

	begin(): void {
		this.execute('BEGIN')
	}

	commit(): void {
		this.execute('COMMIT')
	}

	rollback(): void {
		this.execute('ROLLBACK')
	}

	// A pragma takes no bind parameters, so both guards run before any text is built.
	pragma(name: string, value?: string | number): SQLiteValue | undefined {
		if (!isPragmaName(name)) {
			throw new SQLiteError(
				'INVALID',
				`SQLite pragma name ${preview(name)} is refused: a name is ASCII letters, digits, and underscores, opening with a letter or an underscore`,
				{ pragma: preview(name) },
			)
		}
		if (isDefined(value) && !isPragmaValue(value)) {
			throw new SQLiteError(
				'INVALID',
				`SQLite pragma ${preview(name)} takes a 32-bit signed integer or a keyword of ASCII letters and underscores, not ${preview(value)}`,
				{ pragma: preview(name), value: preview(value) },
			)
		}
		if (isDefined(value)) this.execute('PRAGMA ' + name + ' = ' + value)
		const row = this.prepare('PRAGMA ' + name).get()
		return row ? Object.values(row)[0] : undefined
	}

	// The single connection gate — every operation requires an open database.
	#require(): DatabaseSync {
		if (isUndefined(this.#database)) {
			throw new SQLiteError('CLOSED', 'Database is not connected — call connect() first')
		}
		return this.#database
	}
}
