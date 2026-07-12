import { DatabaseSync } from 'node:sqlite'
import type {
	SQLiteDatabaseInterface,
	SQLiteDatabaseOptions,
	SQLiteStatementInterface,
	SQLiteValue,
} from './types.js'
import { SQLiteError } from './errors.js'
import { wrapError } from './helpers.js'
import { SQLiteStatement } from './SQLiteStatement.js'

/**
 * A synchronous SQLite database over `node:sqlite`'s `DatabaseSync`.
 *
 * @remarks
 * Created by `createSQLiteDatabase`. It connects lazily (`connect` opens the
 * underlying `DatabaseSync`, idempotent) and every operation routes through a
 * private gate that throws a `CLOSED` `SQLiteError` before `connect` or after
 * `close`. `exec` runs result-less SQL; `prepare` compiles a `SQLiteStatement`;
 * `transaction` wraps a scope in `BEGIN` / `COMMIT`, rolling back on a throw;
 * `begin` / `commit` / `rollback` expose those same primitives directly for a
 * long-lived or externally-driven transaction; `pragma` reads (or sets then
 * reads) one PRAGMA value — `name` is trusted
 * internal use only, never untrusted input, since pragma names cannot be bound
 * as parameters. `transacting` reports whether a transaction is currently open
 * (node:sqlite's `isTransaction`), `false` when not connected. A native fault
 * surfaces as a `SQLiteError` mapped at the boundary.
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
		return this.#database !== undefined
	}

	get transacting(): boolean {
		return this.#database?.isTransaction ?? false
	}

	connect(): void {
		if (this.#database === undefined) {
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

	/** Close the connection — enables `using db = createSQLiteDatabase(...)`. */
	[Symbol.dispose](): void {
		this.close()
	}

	exec(sql: string): void {
		try {
			this.#require().exec(sql)
		} catch (error) {
			throw wrapError(error)
		}
	}

	prepare(sql: string): SQLiteStatementInterface {
		try {
			return new SQLiteStatement(this.#require().prepare(sql))
		} catch (error) {
			throw wrapError(error)
		}
	}

	transaction<R>(scope: () => R): R {
		this.begin()
		try {
			const result = scope()
			this.commit()
			return result
		} catch (error) {
			// A ROLLBACK fault (e.g. the database was closed by the scope) must never
			// mask the scope's own error — the caller needs to see why it failed.
			try {
				this.rollback()
			} catch {
				// swallowed — the original `error` is what the caller needs to see
			}
			throw error
		}
	}

	begin(): void {
		this.exec('BEGIN')
	}

	commit(): void {
		this.exec('COMMIT')
	}

	rollback(): void {
		this.exec('ROLLBACK')
	}

	// Pragmas cannot use bind parameters, so the value is interpolated — safe for
	// the trusted internal names this layer is called with.
	pragma(name: string, value?: string | number): SQLiteValue | undefined {
		if (value !== undefined) this.exec('PRAGMA ' + name + ' = ' + value)
		const row = this.prepare('PRAGMA ' + name).get()
		return row ? Object.values(row)[0] : undefined
	}

	// The single connection gate — every operation requires an open database.
	#require(): DatabaseSync {
		if (this.#database === undefined) {
			throw new SQLiteError('CLOSED', 'Database is not connected — call connect() first')
		}
		return this.#database
	}
}
